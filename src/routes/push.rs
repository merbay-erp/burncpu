// /api/v1/push — Web Push (VAPID) subscription management.
//
//   GET  /push/vapid-public-key                 → base64url EC public key
//   POST /push/subscribe { endpoint, keys{p256dh, auth} }  → 204
//   DELETE /push/unsubscribe { endpoint }       → 204
//
// VAPID_PUBLIC_KEY (base64url, EC P-256, uncompressed point) and
// VAPID_PRIVATE_KEY (base64url 32-byte scalar) live in env.
//
// On notify(), push::send_to_user fires a JSON payload to every
// subscription the user has, in parallel. A 404/410 from the push
// service permanently removes the subscription; other failures bump
// `failures` and trip a quiet auto-disable at >= 10.

use crate::{errors::AppError, middleware::session::CurrentUser, state::AppState};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
    routing::{delete, get, post},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use web_push::{
    ContentEncoding, IsahcWebPushClient, SubscriptionInfo, SubscriptionKeys, VapidSignatureBuilder,
    WebPushClient, WebPushMessageBuilder,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/vapid-public-key", get(vapid_public))
        .route("/subscribe", post(subscribe))
        .route("/unsubscribe", delete(unsubscribe))
        .route("/device", post(register_device))
        .route("/device/{token}", delete(unregister_device))
}

// ── Native mobile push tokens (APNs / FCM) ──────────────────────
//
// The iOS/Android app registers its device token here. Delivery to these
// tokens needs an APNs key / FCM credential configured server-side (the web
// path above uses Web Push/VAPID); storage + lifecycle are handled regardless.

#[derive(Deserialize)]
struct DeviceTokenBody {
    token: String,
    platform: String,
}

async fn register_device(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(body): Json<DeviceTokenBody>,
) -> Result<StatusCode, AppError> {
    if body.token.trim().is_empty() || body.token.len() > 512 {
        return Err(AppError::BadRequest("invalid token".into()));
    }
    let platform = match body.platform.as_str() {
        "ios" | "android" => body.platform.as_str(),
        _ => "unknown",
    };
    sqlx::query(
        "INSERT INTO device_push_tokens (user_id, token, platform) VALUES ($1, $2, $3)
         ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform",
    )
    .bind(user.user_id)
    .bind(&body.token)
    .bind(platform)
    .execute(&state.pg)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn unregister_device(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(token): Path<String>,
) -> Result<StatusCode, AppError> {
    sqlx::query("DELETE FROM device_push_tokens WHERE user_id = $1 AND token = $2")
        .bind(user.user_id)
        .bind(&token)
        .execute(&state.pg)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// Known Web Push provider host suffixes. `validate_public_http_url` blocks
// internal IPs at validation time, but the web-push (isahc/curl) client
// re-resolves the hostname at send time — a DNS-rebinding TOCTOU. Pinning the
// endpoint host to a real push provider closes that hole: an attacker host
// (which would rebind to an internal IP) is rejected at subscribe time and
// never stored. These are all public CDN domains, so they can't resolve to
// an internal target.
const PUSH_HOST_SUFFIXES: &[&str] = &[
    "googleapis.com",            // Chrome / Edge / Brave / Opera / Samsung (FCM)
    "push.services.mozilla.com", // Firefox (autopush)
    "push.apple.com",            // Safari (macOS / iOS 16.4+)
    "notify.windows.com",        // Windows / legacy Edge (WNS)
    "push.microsoft.com",
];

fn is_known_push_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    PUSH_HOST_SUFFIXES
        .iter()
        .any(|s| host == *s || host.ends_with(&format!(".{s}")))
}

fn vapid_public_key() -> Option<String> {
    std::env::var("VAPID_PUBLIC_KEY")
        .ok()
        .filter(|s| !s.trim().is_empty())
}
fn vapid_private_key() -> Option<String> {
    std::env::var("VAPID_PRIVATE_KEY")
        .ok()
        .filter(|s| !s.trim().is_empty())
}
fn vapid_subject() -> String {
    std::env::var("VAPID_SUBJECT").unwrap_or_else(|_| "mailto:hi@burncpu.com".into())
}

async fn vapid_public(State(_): State<AppState>) -> impl IntoResponse {
    let key = vapid_public_key().unwrap_or_default();
    let mut h = HeaderMap::new();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600"),
    );
    (h, key)
}

#[derive(Deserialize)]
pub struct SubKeys {
    p256dh: String,
    auth: String,
}

#[derive(Deserialize)]
pub struct SubscribeBody {
    endpoint: String,
    keys: SubKeys,
}

async fn subscribe(
    State(state): State<AppState>,
    user: CurrentUser,
    headers: HeaderMap,
    Json(b): Json<SubscribeBody>,
) -> Result<axum::http::StatusCode, AppError> {
    if b.endpoint.trim().is_empty() {
        return Err(AppError::BadRequest("endpoint required".into()));
    }
    let endpoint = crate::net_safety::validate_public_http_url(&b.endpoint)
        .await
        .map_err(|e| AppError::BadRequest(format!("endpoint is not public https: {e}")))?;
    if endpoint.scheme() != "https" {
        return Err(AppError::BadRequest("endpoint must be https".into()));
    }
    if !is_known_push_host(endpoint.host_str().unwrap_or("")) {
        return Err(AppError::BadRequest(
            "endpoint host is not a recognized push service".into(),
        ));
    }
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .chars()
        .take(255)
        .collect::<String>();

    sqlx::query(
        r#"
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (endpoint) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            p256dh  = EXCLUDED.p256dh,
            auth    = EXCLUDED.auth,
            user_agent = EXCLUDED.user_agent,
            failures = 0
        "#,
    )
    .bind(user.user_id)
    .bind(endpoint.as_str())
    .bind(&b.keys.p256dh)
    .bind(&b.keys.auth)
    .bind(&ua)
    .execute(&state.pg)
    .await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct UnsubBody {
    endpoint: String,
}

async fn unsubscribe(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(b): Json<UnsubBody>,
) -> Result<axum::http::StatusCode, AppError> {
    sqlx::query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2")
        .bind(&b.endpoint)
        .bind(user.user_id)
        .execute(&state.pg)
        .await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ─── Dispatcher (called from notify()) ─────────────────────────

#[derive(Serialize)]
struct Payload<'a> {
    title: &'a str,
    body: &'a str,
    url: &'a str,
    kind: &'a str,
}

pub async fn send_to_user(
    state: &AppState,
    user_id: Uuid,
    kind: &str,
    actor_username: Option<&str>,
    target_kind: &str,
    target_id: Uuid,
) {
    let Some(priv_key) = vapid_private_key() else {
        return;
    };
    let subject = vapid_subject();

    let who = actor_username.unwrap_or("biri");
    let title = match kind {
        "reaction" => format!("@{who} postuna tepki verdi"),
        "reply" => format!("@{who} yanıt verdi"),
        "follow" => format!("@{who} seni takip etti"),
        "mention" => format!("@{who} seni bahsetti"),
        "dm" => format!("@{who} mesaj attı"),
        _ => format!("@{who} → {kind}"),
    };
    let url = if target_kind == "post" {
        format!("/posts/{target_id}")
    } else if target_kind == "thread" {
        format!("/dm/{who}")
    } else {
        "/notifications".to_string()
    };
    let payload = serde_json::to_string(&Payload {
        title: &title,
        body: "burncpu",
        url: &url,
        kind,
    })
    .unwrap_or_default();

    let subs: Vec<(Uuid, String, String, String)> = sqlx::query_as(
        "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1 AND failures < 10",
    )
    .bind(user_id)
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();

    if subs.is_empty() {
        return;
    }

    let client = match IsahcWebPushClient::new() {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(?e, "push client init failed");
            return;
        }
    };

    for (id, endpoint, p256dh, auth) in subs {
        let endpoint = match crate::net_safety::validate_public_http_url(&endpoint).await {
            Ok(url)
                if url.scheme() == "https" && is_known_push_host(url.host_str().unwrap_or("")) =>
            {
                url.to_string()
            }
            Ok(_) | Err(_) => {
                let _ = sqlx::query("DELETE FROM push_subscriptions WHERE id = $1")
                    .bind(id)
                    .execute(&state.pg)
                    .await;
                continue;
            }
        };
        let info = SubscriptionInfo {
            endpoint: endpoint.clone(),
            keys: SubscriptionKeys { p256dh, auth },
        };
        let sig =
            match VapidSignatureBuilder::from_base64(&priv_key, web_push::URL_SAFE_NO_PAD, &info) {
                Ok(mut b) => {
                    b.add_claim("sub", subject.as_str());
                    match b.build() {
                        Ok(s) => s,
                        Err(e) => {
                            tracing::warn!(?e, "vapid sign failed");
                            continue;
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(?e, "vapid builder init failed");
                    continue;
                }
            };

        let mut builder = WebPushMessageBuilder::new(&info);
        builder.set_payload(ContentEncoding::Aes128Gcm, payload.as_bytes());
        builder.set_vapid_signature(sig);
        builder.set_ttl(86_400);
        let msg = match builder.build() {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!(?e, "push build");
                continue;
            }
        };

        let pg = state.pg.clone();
        let client = client.clone();
        let ep = endpoint.clone();
        tokio::spawn(async move {
            match client.send(msg).await {
                Ok(_) => {
                    let _ = sqlx::query("UPDATE push_subscriptions SET failures = 0 WHERE id = $1")
                        .bind(id)
                        .execute(&pg)
                        .await;
                }
                Err(e) => {
                    let gone = matches!(
                        &e,
                        web_push::WebPushError::EndpointNotValid
                            | web_push::WebPushError::EndpointNotFound
                    );
                    if gone {
                        let _ = sqlx::query("DELETE FROM push_subscriptions WHERE id = $1")
                            .bind(id)
                            .execute(&pg)
                            .await;
                        tracing::info!(%ep, "push subscription gone — pruned");
                    } else {
                        let _ = sqlx::query(
                            "UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1",
                        )
                        .bind(id)
                        .execute(&pg)
                        .await;
                        tracing::warn!(?e, %ep, "push send failed");
                    }
                }
            }
        });
    }
}

/// Fan a notification out to the user's registered Expo push tokens via Expo's
/// push service (which routes to APNs/FCM). No-op until the mobile app produces
/// real ExponentPushTokens (needs app.json `extra.eas.projectId` + a dev/standalone
/// build) and the Expo project has FCM/APNs creds. Raw FCM/APNs tokens are skipped.
pub async fn send_to_device_tokens(
    state: &AppState,
    user_id: Uuid,
    kind: &str,
    actor_username: Option<&str>,
    target_kind: &str,
    target_id: Uuid,
) {
    let tokens: Vec<String> =
        sqlx::query_scalar("SELECT token FROM device_push_tokens WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(&state.pg)
            .await
            .unwrap_or_default();
    let expo: Vec<String> = tokens
        .into_iter()
        .filter(|t| t.starts_with("ExponentPushToken") || t.starts_with("ExpoPushToken"))
        .collect();
    if expo.is_empty() {
        return;
    }
    let who = actor_username.unwrap_or("biri");
    let title = match kind {
        "reaction" => format!("@{who} postuna tepki verdi"),
        "reply" => format!("@{who} yanıt verdi"),
        "follow" => format!("@{who} seni takip etti"),
        "mention" => format!("@{who} seni bahsetti"),
        "dm" => format!("@{who} mesaj attı"),
        _ => format!("@{who} → {kind}"),
    };
    let url = if target_kind == "post" {
        format!("/posts/{target_id}")
    } else if target_kind == "thread" {
        format!("/dm/{who}")
    } else {
        "/notifications".to_string()
    };
    let messages: Vec<serde_json::Value> = expo
        .iter()
        .map(|t| {
            serde_json::json!({
                "to": t, "title": title, "body": "burncpu",
                "sound": "default", "priority": "high", "channelId": "default",
                "data": { "url": url, "kind": kind },
            })
        })
        .collect();
    let client = reqwest::Client::new();
    if let Err(e) = client
        .post("https://exp.host/--/api/v2/push/send")
        .json(&messages)
        .send()
        .await
    {
        tracing::warn!(?e, "expo push send failed");
    }
}
