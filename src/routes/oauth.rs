// OAuth2 social login (Google, GitHub, Microsoft; Apple slots in later — it
// needs a signed-JWT client secret + a paid Apple Developer account).
//
// Generic authorization-code flow:
//   GET  /api/v1/oauth/providers            → enabled provider names (for the UI)
//   GET  /api/v1/oauth/{provider}/start      → 302 to the provider's consent page
//   GET  /api/v1/oauth/{provider}/callback   → exchange code, find/create user, session
//   POST /api/v1/oauth/exchange              → mobile: swap one-time code → session token
//
// A provider is "enabled" iff its CLIENT_ID/SECRET are configured (Config::oauth).
// New users go through the same `upsert_user` path as magic-link, so the open/
// invite-gated policy, admin bootstrap, and 2FA all apply uniformly.
//
// SECURITY:
//   - state is a one-time CSRF token stored in Redis (consumed on callback).
//   - PKCE (S256) is used for providers that support it.
//   - only a provider-VERIFIED email is ever used to match or create an account.
//   - web: session arrives as a Secure;HttpOnly cookie. mobile: the deep-link
//     carries a 60s single-use exchange code (NOT the session token), which the
//     app swaps for the token over TLS — so custom-scheme hijacking can't lift a
//     usable session.

use std::net::SocketAddr;

use axum::{
    Router,
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, header},
    response::{IntoResponse, Json, Redirect, Response},
    routing::{get, post},
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    auth::{base64url_encode, new_token},
    errors::AppError,
    middleware::client_ip,
    routes::auth::{issue_session_token, read_ua, session_cookie, upsert_user},
    state::AppState,
};

const STATE_TTL_SECS: u64 = 600;
const EXCHANGE_TTL_SECS: u64 = 60;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/providers", get(list_providers))
        .route("/exchange", post(exchange))
        .route("/{provider}/start", get(start))
        .route("/{provider}/callback", get(callback))
}

/// Compile-time OAuth2 endpoint definition for one provider.
struct ProviderDef {
    name: &'static str,
    authorize_url: &'static str,
    token_url: &'static str,
    userinfo_url: &'static str,
    scope: &'static str,
    uses_pkce: bool,
}

fn provider_def(name: &str) -> Option<ProviderDef> {
    Some(match name {
        "google" => ProviderDef {
            name: "google",
            authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
            token_url: "https://oauth2.googleapis.com/token",
            userinfo_url: "https://openidconnect.googleapis.com/v1/userinfo",
            scope: "openid email profile",
            uses_pkce: true,
        },
        "github" => ProviderDef {
            name: "github",
            authorize_url: "https://github.com/login/oauth/authorize",
            token_url: "https://github.com/login/oauth/access_token",
            userinfo_url: "https://api.github.com/user",
            scope: "read:user user:email",
            uses_pkce: false,
        },
        "microsoft" => ProviderDef {
            name: "microsoft",
            authorize_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            token_url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            userinfo_url: "https://graph.microsoft.com/oidc/userinfo",
            scope: "openid email profile",
            uses_pkce: true,
        },
        _ => return None,
    })
}

fn redirect_uri(state: &AppState, provider: &str) -> String {
    format!(
        "{}/api/v1/oauth/{provider}/callback",
        state.config.site_origin
    )
}

fn sha256(data: &[u8]) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    Sha256::digest(data).to_vec()
}

// ── GET /providers ────────────────────────────────────────────────
async fn list_providers(State(state): State<AppState>) -> Json<Vec<String>> {
    let mut names: Vec<String> = state.config.oauth.keys().cloned().collect();
    names.sort();
    Json(names)
}

#[derive(Deserialize)]
struct StartQuery {
    /// "web" (default) → Set-Cookie + redirect to site; "mobile" → deep-link code.
    flow: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct StateRecord {
    provider: String,
    pkce_verifier: String,
    flow: String,
}

// ── GET /{provider}/start ─────────────────────────────────────────
async fn start(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    Query(q): Query<StartQuery>,
) -> Result<Response, AppError> {
    let def = provider_def(&provider).ok_or(AppError::NotFound)?;
    let creds = state
        .config
        .oauth
        .get(&provider)
        .ok_or_else(|| AppError::BadRequest(format!("{provider} login not configured")))?;

    let flow = if q.flow.as_deref() == Some("mobile") {
        "mobile"
    } else {
        "web"
    };

    let (state_token, _) = new_token().map_err(AppError::Internal)?;
    let (pkce_verifier, _) = new_token().map_err(AppError::Internal)?;

    let rec = StateRecord {
        provider: provider.clone(),
        pkce_verifier: pkce_verifier.clone(),
        flow: flow.to_string(),
    };
    let mut redis = state.redis.clone();
    let _: () = redis
        .set_ex(
            format!("oauth:state:{state_token}"),
            serde_json::to_string(&rec).map_err(|e| AppError::Internal(e.into()))?,
            STATE_TTL_SECS,
        )
        .await?;

    let mut params: Vec<(&str, String)> = vec![
        ("client_id", creds.client_id.clone()),
        ("redirect_uri", redirect_uri(&state, &provider)),
        ("response_type", "code".into()),
        ("scope", def.scope.into()),
        ("state", state_token),
    ];
    if def.uses_pkce {
        params.push((
            "code_challenge",
            base64url_encode(&sha256(pkce_verifier.as_bytes())),
        ));
        params.push(("code_challenge_method", "S256".into()));
    }
    if provider == "google" {
        params.push(("prompt", "select_account".into()));
    }

    let url = reqwest::Url::parse_with_params(def.authorize_url, &params)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    Ok(Redirect::to(url.as_str()).into_response())
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

struct Profile {
    provider_id: String,
    /// Verified email only — `None` if the provider couldn't vouch for one.
    email: Option<String>,
    name: Option<String>,
    avatar: Option<String>,
}

// ── GET /{provider}/callback ──────────────────────────────────────
async fn callback(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<CallbackQuery>,
) -> Result<Response, AppError> {
    let def = provider_def(&provider).ok_or(AppError::NotFound)?;
    let creds = state
        .config
        .oauth
        .get(&provider)
        .ok_or_else(|| AppError::BadRequest(format!("{provider} login not configured")))?;

    if let Some(err) = q.error {
        return Err(AppError::BadRequest(format!("provider error: {err}")));
    }
    let code = q
        .code
        .ok_or_else(|| AppError::BadRequest("missing code".into()))?;
    let state_token = q
        .state
        .ok_or_else(|| AppError::BadRequest("missing state".into()))?;

    // Consume one-time state (CSRF protection).
    let mut redis = state.redis.clone();
    let key = format!("oauth:state:{state_token}");
    let rec_json: Option<String> = redis.get(&key).await?;
    let rec_json =
        rec_json.ok_or_else(|| AppError::BadRequest("invalid or expired state".into()))?;
    let _: () = redis.del(&key).await?;
    let rec: StateRecord =
        serde_json::from_str(&rec_json).map_err(|e| AppError::Internal(e.into()))?;
    if rec.provider != provider {
        return Err(AppError::BadRequest("state provider mismatch".into()));
    }

    let client = reqwest::Client::new();

    // Exchange authorization code → access token.
    let mut form: Vec<(&str, String)> = vec![
        ("grant_type", "authorization_code".into()),
        ("code", code),
        ("redirect_uri", redirect_uri(&state, &provider)),
        ("client_id", creds.client_id.clone()),
        ("client_secret", creds.client_secret.clone()),
    ];
    if def.uses_pkce {
        form.push(("code_verifier", rec.pkce_verifier));
    }
    let token_resp = client
        .post(def.token_url)
        .header(header::ACCEPT, "application/json")
        .header(header::USER_AGENT, "burncpu")
        .form(&form)
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    if !token_resp.status().is_success() {
        let body = token_resp.text().await.unwrap_or_default();
        tracing::warn!(%provider, %body, "oauth token exchange failed");
        return Err(AppError::BadRequest("token exchange failed".into()));
    }
    let token_json: Value = token_resp
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let access_token = token_json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("no access_token in response".into()))?;

    let profile = fetch_profile(&client, &def, access_token).await?;

    // Resolve to a user: existing identity wins; otherwise match/create by the
    // provider-verified email and record the identity.
    let existing: Option<uuid::Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM oauth_identities WHERE provider = $1 AND provider_id = $2",
    )
    .bind(&provider)
    .bind(&profile.provider_id)
    .fetch_optional(&state.pg)
    .await?;

    let user_id = match existing {
        Some(uid) => uid,
        None => {
            let email = profile.email.as_deref().ok_or_else(|| {
                AppError::BadRequest("provider did not return a verified email".into())
            })?;
            // Email-matching may NOT link a first-time OAuth identity to an
            // admin account, on any provider: a provider-side email claim is a
            // weaker proof than our own magic-link, and admins are the prize
            // target. Already-linked identities (the Some(uid) fast path) keep
            // working; a fresh link to an admin requires magic-link (+2FA).
            let admin_match: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM users WHERE email = $1 AND role = 'admin')",
            )
            .bind(email)
            .fetch_one(&state.pg)
            .await?;
            if admin_match {
                return Err(AppError::Forbidden);
            }
            let uid = upsert_user(&state, email, None, &state.pg).await?;
            sqlx::query(
                r#"
                INSERT INTO oauth_identities (provider, provider_id, user_id, email, name, avatar_url)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (provider, provider_id) DO UPDATE
                SET email = EXCLUDED.email, name = EXCLUDED.name,
                    avatar_url = EXCLUDED.avatar_url, updated_at = NOW()
                "#,
            )
            .bind(&provider)
            .bind(&profile.provider_id)
            .bind(uid)
            .bind(&profile.email)
            .bind(&profile.name)
            .bind(&profile.avatar)
            .execute(&state.pg)
            .await?;
            uid
        }
    };

    let ip_str = client_ip::extract(&headers, Some(&peer))
        .map(|ip| ip.to_string())
        .unwrap_or_else(|| "0.0.0.0".to_string());
    let ua = read_ua(&headers);
    let (session_raw, pending_2fa) = issue_session_token(&state, user_id, &ip_str, &ua).await?;

    if rec.flow == "mobile" {
        // Hand the app a short-lived, single-use code instead of the session.
        let (exchange_code, _) = new_token().map_err(AppError::Internal)?;
        let payload = serde_json::json!({ "session": session_raw, "pending_2fa": pending_2fa });
        let _: () = redis
            .set_ex(
                format!("oauth:exchange:{exchange_code}"),
                payload.to_string(),
                EXCHANGE_TTL_SECS,
            )
            .await?;
        let url = format!("burncpu://auth/oauth-callback?code={exchange_code}");
        Ok(Redirect::to(&url).into_response())
    } else {
        let target = if pending_2fa {
            format!("{}/2fa", state.config.site_origin)
        } else {
            format!("{}/", state.config.site_origin)
        };
        let mut resp = Redirect::to(&target).into_response();
        resp.headers_mut().insert(
            header::SET_COOKIE,
            session_cookie(&session_raw, &state.config)?,
        );
        Ok(resp)
    }
}

#[derive(Deserialize)]
struct ExchangeReq {
    code: String,
}

// ── POST /exchange (mobile) ───────────────────────────────────────
// Swaps the one-time code for the session, delivered as a `Set-Cookie` that the
// app's own fetch stores in its native cookie jar — exactly like the magic-link
// flow, so no Bearer token or extra cookie plumbing is needed on the client.
async fn exchange(
    State(state): State<AppState>,
    Json(req): Json<ExchangeReq>,
) -> Result<Response, AppError> {
    let mut redis = state.redis.clone();
    let key = format!("oauth:exchange:{}", req.code);
    let payload: Option<String> = redis.get(&key).await?;
    let payload = payload.ok_or_else(|| AppError::BadRequest("invalid or expired code".into()))?;
    let _: () = redis.del(&key).await?; // single-use
    let v: Value = serde_json::from_str(&payload).map_err(|e| AppError::Internal(e.into()))?;
    let session = v
        .get("session")
        .and_then(|s| s.as_str())
        .unwrap_or_default();
    let pending_2fa = v
        .get("pending_2fa")
        .and_then(|b| b.as_bool())
        .unwrap_or(false);
    if session.is_empty() {
        return Err(AppError::BadRequest("invalid code".into()));
    }
    let mut resp = Json(serde_json::json!({ "pending_2fa": pending_2fa })).into_response();
    resp.headers_mut()
        .insert(header::SET_COOKIE, session_cookie(session, &state.config)?);
    Ok(resp)
}

// ── provider profile fetch ────────────────────────────────────────
async fn fetch_profile(
    client: &reqwest::Client,
    def: &ProviderDef,
    access_token: &str,
) -> Result<Profile, AppError> {
    let resp = client
        .get(def.userinfo_url)
        .bearer_auth(access_token)
        .header(header::USER_AGENT, "burncpu")
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    if !resp.status().is_success() {
        return Err(AppError::BadRequest("userinfo fetch failed".into()));
    }
    let j: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    match def.name {
        "google" => {
            // email_verified may be bool or "true"/"false" string depending on flow.
            let verified = j
                .get("email_verified")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
                || j.get("email_verified").and_then(|v| v.as_str()) == Some("true");
            Ok(Profile {
                provider_id: j
                    .get("sub")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
                email: verified
                    .then(|| j.get("email").and_then(|v| v.as_str()).map(String::from))
                    .flatten(),
                name: j.get("name").and_then(|v| v.as_str()).map(String::from),
                avatar: j.get("picture").and_then(|v| v.as_str()).map(String::from),
            })
        }
        "microsoft" => {
            // Microsoft's OIDC userinfo normally returns directory-verified
            // emails (and post-nOAuth app registrations strip unverified email
            // claims by default) — but if an email_verified claim IS present and
            // false, honour it and drop the email rather than trust it.
            let unverified = j.get("email_verified").and_then(|v| v.as_bool()) == Some(false)
                || j.get("email_verified").and_then(|v| v.as_str()) == Some("false");
            Ok(Profile {
                provider_id: j
                    .get("sub")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
                email: (!unverified)
                    .then(|| j.get("email").and_then(|v| v.as_str()).map(String::from))
                    .flatten(),
                name: j.get("name").and_then(|v| v.as_str()).map(String::from),
                avatar: None,
            })
        }
        "github" => {
            let provider_id = j
                .get("id")
                .and_then(|v| v.as_i64())
                .map(|n| n.to_string())
                .unwrap_or_default();
            let name = j
                .get("name")
                .and_then(|v| v.as_str())
                .or_else(|| j.get("login").and_then(|v| v.as_str()))
                .map(String::from);
            let avatar = j
                .get("avatar_url")
                .and_then(|v| v.as_str())
                .map(String::from);
            // GitHub's /user.email is null when private — fetch the verified primary.
            let email = github_primary_email(client, access_token).await;
            Ok(Profile {
                provider_id,
                email,
                name,
                avatar,
            })
        }
        _ => Err(AppError::NotFound),
    }
}

async fn github_primary_email(client: &reqwest::Client, access_token: &str) -> Option<String> {
    let resp = client
        .get("https://api.github.com/user/emails")
        .bearer_auth(access_token)
        .header(header::USER_AGENT, "burncpu")
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let arr: Value = resp.json().await.ok()?;
    let emails = arr.as_array()?;
    let verified = |e: &&Value| e.get("verified").and_then(|v| v.as_bool()).unwrap_or(false);
    emails
        .iter()
        .find(|e| e.get("primary").and_then(|v| v.as_bool()).unwrap_or(false) && verified(e))
        .or_else(|| emails.iter().find(verified))
        .and_then(|e| e.get("email").and_then(|v| v.as_str()).map(String::from))
}
