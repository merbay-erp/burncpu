// /api/v1/webhooks — outgoing event subscriptions.
//
//   GET    /webhooks                → list yours
//   POST   /webhooks  { url, events[], active? }   → 201 (returns secret ONCE)
//   PATCH  /webhooks/{id}           → partial: { active, events }
//   DELETE /webhooks/{id}           → remove
//
// dispatch_event(state, event_name, target_user_id, payload) is called by
// notify() and posts to every matching active hook in parallel. Failed
// deliveries (network or non-2xx) bump failure_streak; ≥20 disables the
// webhook automatically.

use crate::{errors::AppError, middleware::session::CurrentUser, state::AppState};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch},
};
use hmac::Mac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::Sha256;
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", patch(update).delete(remove))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct WebhookRow {
    id: Uuid,
    url: String,
    events: Vec<String>,
    active: bool,
    last_called_at: Option<DateTime<Utc>>,
    last_status: Option<i16>,
    failure_streak: i32,
    created_at: DateTime<Utc>,
}

async fn list(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<Vec<WebhookRow>>, AppError> {
    let rows: Vec<WebhookRow> = sqlx::query_as(
        r#"
        SELECT id, url, events, active, last_called_at, last_status, failure_streak, created_at
        FROM webhooks WHERE user_id = $1 ORDER BY created_at DESC
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

const ALLOWED_EVENTS: &[&str] = &["reaction", "reply", "follow", "mention", "dm"];
const MAX_WEBHOOKS_PER_USER: i64 = 10;

#[derive(Deserialize)]
pub struct CreateBody {
    url: String,
    events: Vec<String>,
    #[serde(default = "default_true")]
    active: bool,
}
fn default_true() -> bool {
    true
}

#[derive(Serialize)]
pub struct CreatedWebhook {
    id: Uuid,
    url: String,
    events: Vec<String>,
    secret: String, // shown ONCE
}

async fn create(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<CreateBody>,
) -> Result<(StatusCode, Json<CreatedWebhook>), AppError> {
    let url = input.url.trim();
    let safe_url = crate::net_safety::validate_public_http_url(url)
        .await
        .map_err(|e| AppError::BadRequest(format!("url is not a public http(s) endpoint: {e}")))?;
    // HTTPS-only: a webhook secret + payload must never go out in cleartext.
    if safe_url.scheme() != "https" {
        return Err(AppError::BadRequest("webhook url must use https".into()));
    }
    if input.events.is_empty() {
        return Err(AppError::BadRequest("at least one event required".into()));
    }
    for e in &input.events {
        if !ALLOWED_EVENTS.contains(&e.as_str()) {
            return Err(AppError::BadRequest(format!(
                "invalid event: {e} (allowed: {})",
                ALLOWED_EVENTS.join(", ")
            )));
        }
    }
    // Per-user cap so one account can't register an unbounded fan-out.
    let existing: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM webhooks WHERE user_id = $1")
        .bind(user.user_id)
        .fetch_one(&state.pg)
        .await?;
    if existing >= MAX_WEBHOOKS_PER_USER {
        return Err(AppError::BadRequest(format!(
            "webhook limit reached (max {MAX_WEBHOOKS_PER_USER})"
        )));
    }
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    let secret = hex_encode(&buf);
    // Encrypt the signing secret at rest (XChaCha20-Poly1305). The plaintext is
    // returned to the caller exactly once below and never persisted.
    let (secret_enc, secret_nonce) =
        crate::auth::totp::encrypt_blob(secret.as_bytes()).map_err(AppError::Internal)?;

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO webhooks (user_id, url, secret_encrypted, secret_nonce, events, active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        "#,
    )
    .bind(user.user_id)
    .bind(safe_url.as_str())
    .bind(&secret_enc)
    .bind(&secret_nonce)
    .bind(&input.events)
    .bind(input.active)
    .fetch_one(&state.pg)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(CreatedWebhook {
            id,
            url: safe_url.to_string(),
            events: input.events,
            secret,
        }),
    ))
}

#[derive(Deserialize)]
pub struct UpdateBody {
    active: Option<bool>,
    events: Option<Vec<String>>,
}

async fn update(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateBody>,
) -> Result<StatusCode, AppError> {
    if let Some(ref evs) = input.events {
        for e in evs {
            if !ALLOWED_EVENTS.contains(&e.as_str()) {
                return Err(AppError::BadRequest(format!("invalid event: {e}")));
            }
        }
    }
    let n = sqlx::query(
        r#"
        UPDATE webhooks SET
            active = COALESCE($1, active),
            events = COALESCE($2, events),
            failure_streak = CASE WHEN $1 = true THEN 0 ELSE failure_streak END
        WHERE id = $3 AND user_id = $4
        "#,
    )
    .bind(input.active)
    .bind(input.events.as_ref())
    .bind(id)
    .bind(user.user_id)
    .execute(&state.pg)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn remove(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let n = sqlx::query("DELETE FROM webhooks WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user.user_id)
        .execute(&state.pg)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

// ─── Dispatcher ────────────────────────────────────────────────
//
// A single notification can fan out to several webhooks, and notifications can
// burst, so deliveries are NOT unbounded `tokio::spawn`s. `dispatch_event`
// builds a signed job and pushes it onto a bounded channel; one consumer drains
// it and runs deliveries through a concurrency semaphore. A full queue sheds
// (logged) instead of growing without limit. The signing secret is decrypted
// from its at-rest XChaCha20-Poly1305 form just long enough to sign.

pub struct WebhookJob {
    id: Uuid,
    url: String,
    body: Vec<u8>,
    sig: String,
}

const QUEUE_CAP: usize = 1024;
const MAX_CONCURRENT_DELIVERIES: usize = 8;

/// Start the background delivery worker and return the queue sender to hold in
/// `AppState`. Mirrors the broadcast/cleanup setup in `main`.
pub fn spawn_dispatcher(pg: sqlx::PgPool) -> tokio::sync::mpsc::Sender<WebhookJob> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<WebhookJob>(QUEUE_CAP);
    tokio::spawn(async move {
        let sem = std::sync::Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_DELIVERIES));
        while let Some(job) = rx.recv().await {
            // Acquire BEFORE spawning so at most MAX_CONCURRENT_DELIVERIES
            // delivery tasks exist at once; the channel bounds the backlog.
            let Ok(permit) = sem.clone().acquire_owned().await else {
                break; // semaphore closed → shutting down
            };
            let pg = pg.clone();
            tokio::spawn(async move {
                let _permit = permit;
                deliver(&pg, job).await;
            });
        }
    });
    tx
}

async fn deliver(pg: &sqlx::PgPool, job: WebhookJob) {
    let WebhookJob { id, url, body, sig } = job;
    let (http, safe_url) = match crate::net_safety::safe_client_for(
        &url,
        "burncpu-webhook/1",
        std::time::Duration::from_secs(5),
    )
    .await
    {
        Ok(pair) => pair,
        Err(e) => {
            tracing::warn!(?e, webhook_id = %id, %url, "webhook URL blocked");
            let _ = sqlx::query(
                r#"
                UPDATE webhooks SET
                    last_called_at = NOW(),
                    last_status = NULL,
                    failure_streak = failure_streak + 1,
                    active = CASE WHEN failure_streak + 1 >= 20 THEN false ELSE active END
                WHERE id = $1
                "#,
            )
            .bind(id)
            .execute(pg)
            .await;
            return;
        }
    };
    let resp = http
        .post(safe_url.as_str())
        .header("Content-Type", "application/json")
        .header("X-Burncpu-Signature", format!("sha256={sig}"))
        .body(body)
        .send()
        .await;
    let status: Option<i16> = match &resp {
        Ok(r) => Some(r.status().as_u16() as i16),
        Err(_) => None,
    };
    let ok = matches!(status, Some(s) if (200..300).contains(&s));
    let _ = sqlx::query(
        r#"
        UPDATE webhooks SET
            last_called_at = NOW(),
            last_status = $1,
            failure_streak = CASE WHEN $2 THEN 0 ELSE failure_streak + 1 END,
            active = CASE WHEN NOT $2 AND failure_streak + 1 >= 20 THEN false ELSE active END
        WHERE id = $3
        "#,
    )
    .bind(status)
    .bind(ok)
    .bind(id)
    .execute(pg)
    .await;
}

// (id, url, secret_encrypted, secret_nonce, events)
type DispatchRow = (Uuid, String, Vec<u8>, Vec<u8>, Vec<String>);

pub async fn dispatch_event(state: &AppState, user_id: Uuid, event: &str, payload: &JsonValue) {
    let rows: Vec<DispatchRow> = sqlx::query_as(
        r#"
        SELECT id, url, secret_encrypted, secret_nonce, events FROM webhooks
        WHERE user_id = $1 AND active = true AND failure_streak < 20
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();

    for (id, url, secret_enc, secret_nonce, events) in rows {
        if !events.iter().any(|e| e == event) {
            continue;
        }
        let body = serde_json::json!({
            "event": event,
            "delivered_at": Utc::now(),
            "payload": payload,
        });
        let bytes = match serde_json::to_vec(&body) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let secret = match crate::auth::totp::decrypt_blob(&secret_enc, &secret_nonce) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(?e, webhook_id = %id, "webhook secret decrypt failed; skipping");
                continue;
            }
        };
        let sig = sign_hmac(&secret, &bytes);
        let job = WebhookJob { id, url, body: bytes, sig };
        if let Err(e) = state.webhook_tx.try_send(job) {
            tracing::warn!(%e, webhook_id = %id, "webhook queue full; delivery shed");
        }
    }
}

fn sign_hmac(secret: &[u8], body: &[u8]) -> String {
    type HmacSha256 = hmac::Hmac<Sha256>;
    let mut mac = match HmacSha256::new_from_slice(secret) {
        Ok(mac) => mac,
        Err(_) => unreachable!("HMAC accepts keys of any length"),
    };
    mac.update(body);
    hex_encode(&mac.finalize().into_bytes())
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(s, "{:02x}", b);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_hmac_is_deterministic_and_keyed() {
        let body = br#"{"event":"reaction"}"#;
        let a = sign_hmac(b"secret-key", body);
        let b = sign_hmac(b"secret-key", body);
        let c = sign_hmac(b"other-key", body);
        assert_eq!(a, b, "same key + body → same signature");
        assert_ne!(a, c, "different key → different signature");
        assert_eq!(a.len(), 64, "sha256 hex digest is 64 chars");
    }

    #[test]
    fn encrypted_secret_round_trips_and_signs_identically() {
        // 32-byte key as 64 hex chars. SAFETY: no other test reads this var.
        unsafe {
            std::env::set_var(
                "BURNCPU_ENC_KEY",
                "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
            );
        }
        // The hex secret handed to the webhook owner once at creation.
        let secret = "deadbeefcafef00ddeadbeefcafef00d";
        let (enc, nonce) = crate::auth::totp::encrypt_blob(secret.as_bytes()).unwrap();
        assert_ne!(enc.as_slice(), secret.as_bytes(), "stored form is ciphertext");

        let recovered = crate::auth::totp::decrypt_blob(&enc, &nonce).unwrap();
        assert_eq!(recovered, secret.as_bytes(), "decrypt recovers the secret");

        // The signature from the decrypted secret must equal the one a receiver
        // computes from the plaintext it was given — encryption at rest must not
        // change signing behaviour.
        let body = b"delivery-payload";
        assert_eq!(sign_hmac(&recovered, body), sign_hmac(secret.as_bytes(), body));
    }
}
