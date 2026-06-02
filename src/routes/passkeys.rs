//! Passkeys (WebAuthn) — an additive login method alongside magic-link.
//!
//! Registration (authenticated session):
//!   POST /auth/passkeys/register/start   → CreationChallengeResponse (state → Redis)
//!   POST /auth/passkeys/register/finish   → stores the credential
//! Login (anonymous, discoverable / usernameless):
//!   POST /auth/passkeys/login/start       → { ceremony, options } (state → Redis)
//!   POST /auth/passkeys/login/finish      → sets the session cookie
//! Management (authenticated session):
//!   GET    /auth/passkeys                 → list this user's passkeys
//!   DELETE /auth/passkeys/{id}            → remove one
//!
//! Ceremony state lives in Redis with a 5-minute TTL and is consumed once
//! (GETDEL). A passkey is a first factor — if the account has confirmed TOTP,
//! the minted session still starts `pending_2fa`, exactly like magic-link.

use crate::{
    errors::AppError,
    middleware::{auth_extractor::SessionUser, client_ip},
    routes::auth::{issue_session, log_attempt, read_ua},
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use chrono::{DateTime, Utc};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use uuid::Uuid;
use webauthn_rs::prelude::*;

const CEREMONY_TTL_SECS: u64 = 300;
const MAX_PASSKEYS_PER_USER: i64 = 10;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/register/start", post(register_start))
        .route("/register/finish", post(register_finish))
        .route("/login/start", post(login_start))
        .route("/login/finish", post(login_finish))
        .route("/{id}", delete(remove))
}

// ── helpers ─────────────────────────────────────────────────────

fn webauthn(state: &AppState) -> Result<Webauthn, AppError> {
    let origin = Url::parse(&state.config.site_origin).map_err(into_internal)?;
    let rp_id = origin
        .host_str()
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("site_origin has no host")))?
        .to_string();
    WebauthnBuilder::new(&rp_id, &origin)
        .map_err(wa_err)?
        .rp_name("burncpu")
        .build()
        .map_err(wa_err)
}

fn into_internal<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Internal(anyhow::anyhow!(e.to_string()))
}

fn wa_err(e: WebauthnError) -> AppError {
    // WebAuthn failures are almost always a malformed/late ceremony from the
    // client; never leak internals to the caller.
    tracing::warn!("webauthn ceremony error: {e}");
    AppError::BadRequest("webauthn ceremony failed".into())
}

fn req_ctx(headers: &HeaderMap, peer: &SocketAddr) -> (String, String) {
    let ua = read_ua(headers);
    let ip = client_ip::extract(headers, Some(peer))
        .map(|i| i.to_string())
        .unwrap_or_default();
    (ua, ip)
}

// ── registration ────────────────────────────────────────────────

async fn register_start(
    State(state): State<AppState>,
    user: SessionUser,
) -> Result<Json<CreationChallengeResponse>, AppError> {
    let uid = user.user_id;
    let (username, display_name): (String, String) =
        sqlx::query_as("SELECT username, display_name FROM users WHERE id = $1")
            .bind(uid)
            .fetch_one(&state.pg)
            .await?;

    // Exclude already-registered authenticators so the same device can't be
    // enrolled twice.
    let existing: Vec<Vec<u8>> =
        sqlx::query_scalar("SELECT cred_id FROM webauthn_credentials WHERE user_id = $1")
            .bind(uid)
            .fetch_all(&state.pg)
            .await?;
    let exclude: Vec<CredentialID> = existing.into_iter().map(CredentialID::from).collect();

    let wa = webauthn(&state)?;
    let (ccr, reg_state) = wa
        .start_passkey_registration(uid, &username, &display_name, Some(exclude))
        .map_err(wa_err)?;

    let mut redis = state.redis.clone();
    let _: () = redis
        .set_ex(
            format!("webauthn:reg:{uid}"),
            serde_json::to_string(&reg_state).map_err(into_internal)?,
            CEREMONY_TTL_SECS,
        )
        .await?;
    Ok(Json(ccr))
}

#[derive(Deserialize)]
struct RegisterFinishBody {
    credential: RegisterPublicKeyCredential,
    #[serde(default)]
    name: Option<String>,
}

async fn register_finish(
    State(state): State<AppState>,
    user: SessionUser,
    Json(body): Json<RegisterFinishBody>,
) -> Result<StatusCode, AppError> {
    let uid = user.user_id;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM webauthn_credentials WHERE user_id = $1")
        .bind(uid)
        .fetch_one(&state.pg)
        .await?;
    if count >= MAX_PASSKEYS_PER_USER {
        return Err(AppError::BadRequest("passkey limit reached".into()));
    }

    let mut redis = state.redis.clone();
    let raw: Option<String> = redis.get_del(format!("webauthn:reg:{uid}")).await?;
    let reg_state: PasskeyRegistration = serde_json::from_str(
        &raw.ok_or_else(|| AppError::BadRequest("no registration in progress".into()))?,
    )
    .map_err(into_internal)?;

    let wa = webauthn(&state)?;
    let passkey = wa
        .finish_passkey_registration(&body.credential, &reg_state)
        .map_err(wa_err)?;

    let cred_bytes: &[u8] = passkey.cred_id().as_ref();
    let pk_json = serde_json::to_value(&passkey).map_err(into_internal)?;
    let name = body
        .name
        .as_deref()
        .map(|n| n.trim().chars().take(60).collect::<String>())
        .filter(|n| !n.is_empty());

    sqlx::query(
        "INSERT INTO webauthn_credentials (user_id, cred_id, passkey, name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (cred_id) DO NOTHING",
    )
    .bind(uid)
    .bind(cred_bytes)
    .bind(pk_json)
    .bind(name)
    .execute(&state.pg)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ── discoverable login ──────────────────────────────────────────

#[derive(Serialize)]
struct LoginStartResponse {
    ceremony: Uuid,
    options: RequestChallengeResponse,
}

async fn login_start(State(state): State<AppState>) -> Result<Json<LoginStartResponse>, AppError> {
    let wa = webauthn(&state)?;
    let (rcr, auth_state) = wa.start_discoverable_authentication().map_err(wa_err)?;
    let ceremony = Uuid::new_v4();
    let mut redis = state.redis.clone();
    let _: () = redis
        .set_ex(
            format!("webauthn:auth:{ceremony}"),
            serde_json::to_string(&auth_state).map_err(into_internal)?,
            CEREMONY_TTL_SECS,
        )
        .await?;
    Ok(Json(LoginStartResponse {
        ceremony,
        options: rcr,
    }))
}

#[derive(Deserialize)]
struct LoginFinishBody {
    ceremony: Uuid,
    credential: PublicKeyCredential,
}

async fn login_finish(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<LoginFinishBody>,
) -> Result<Response, AppError> {
    let (ua, ip) = req_ctx(&headers, &peer);

    let mut redis = state.redis.clone();
    let raw: Option<String> = redis
        .get_del(format!("webauthn:auth:{}", body.ceremony))
        .await?;
    let auth_state: DiscoverableAuthentication =
        serde_json::from_str(&raw.ok_or(AppError::Unauthorized)?).map_err(into_internal)?;

    let wa = webauthn(&state)?;

    // The authenticator embeds the user handle (our user UUID) — recover it,
    // then load only that user's credentials to finish against.
    let (user_uuid, _used_cred) = wa
        .identify_discoverable_authentication(&body.credential)
        .map_err(wa_err)?;

    let rows: Vec<(Uuid, serde_json::Value)> =
        sqlx::query_as("SELECT id, passkey FROM webauthn_credentials WHERE user_id = $1")
            .bind(user_uuid)
            .fetch_all(&state.pg)
            .await?;
    if rows.is_empty() {
        return Err(AppError::Unauthorized);
    }
    let mut passkeys: Vec<(Uuid, Passkey)> = rows
        .into_iter()
        .filter_map(|(id, v)| serde_json::from_value::<Passkey>(v).ok().map(|pk| (id, pk)))
        .collect();

    let dkeys: Vec<DiscoverableKey> = passkeys.iter().map(|(_, pk)| DiscoverableKey::from(pk)).collect();
    let result = wa
        .finish_discoverable_authentication(&body.credential, auth_state, &dkeys)
        .map_err(wa_err)?;

    // Persist a counter bump (replay/clone detection) on the credential used.
    if let Some((id, pk)) = passkeys.iter_mut().find(|(_, pk)| pk.cred_id() == result.cred_id()) {
        if result.needs_update() && pk.update_credential(&result).is_some() {
            let v = serde_json::to_value(&*pk).map_err(into_internal)?;
            let _ = sqlx::query("UPDATE webauthn_credentials SET passkey = $1, last_used_at = NOW() WHERE id = $2")
                .bind(v)
                .bind(*id)
                .execute(&state.pg)
                .await;
        } else {
            let _ = sqlx::query("UPDATE webauthn_credentials SET last_used_at = NOW() WHERE id = $1")
                .bind(*id)
                .execute(&state.pg)
                .await;
        }
    }

    let (cookie, pending_2fa) = issue_session(&state, user_uuid, &ip, &ua).await?;
    log_attempt(&state, None, "passkey", "ok", &ip, &ua, Some(user_uuid)).await;

    let mut resp = (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true, "pending_2fa": pending_2fa })),
    )
        .into_response();
    resp.headers_mut().insert(header::SET_COOKIE, cookie);
    Ok(resp)
}

// ── management ──────────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
struct PasskeyRow {
    id: Uuid,
    name: Option<String>,
    created_at: DateTime<Utc>,
    last_used_at: Option<DateTime<Utc>>,
}

async fn list(
    State(state): State<AppState>,
    user: SessionUser,
) -> Result<Json<Vec<PasskeyRow>>, AppError> {
    let rows = sqlx::query_as::<_, PasskeyRow>(
        "SELECT id, name, created_at, last_used_at FROM webauthn_credentials
         WHERE user_id = $1 ORDER BY created_at",
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

async fn remove(
    State(state): State<AppState>,
    user: SessionUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    sqlx::query("DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user.user_id)
        .execute(&state.pg)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
