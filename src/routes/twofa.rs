// /api/v1/auth/2fa/* — TOTP enrollment / verification.
//
//   POST /auth/2fa/enroll               → 200 { otpauth_uri, secret, recovery_codes[] }
//                                         (creates a pending enrollment; not active until /confirm)
//   POST /auth/2fa/confirm { code }     → 204 (marks confirmed; admin signins from now on require 2FA)
//   POST /auth/2fa/challenge { code }   → 204 (clears pending_2fa on current session)
//   POST /auth/2fa/disable { code }     → 204 (wipe row; requires a valid code to disable)
//
// All endpoints require an authenticated session. /challenge is the only
// one that works while pending_2fa is true on the session (it's the only
// way to clear it).

use crate::{
    auth::{hash_token, token::SESSION_COOKIE, totp},
    errors::AppError,
    middleware::auth_extractor::SessionUser,
    state::AppState,
};
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    routing::post,
};
use serde::{Deserialize, Serialize};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/status", axum::routing::get(status))
        .route("/enroll", post(enroll))
        .route("/confirm", post(confirm))
        .route("/challenge", post(challenge))
        .route("/disable", post(disable))
}

#[derive(Serialize)]
pub struct Status {
    enrolled: bool,
    confirmed: bool,
    recovery_codes_remaining: i32,
}

async fn status(
    State(state): State<AppState>,
    user: SessionUser,
) -> Result<Json<Status>, AppError> {
    let row: Option<(Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>>, i32)> =
        sqlx::query_as(
            "SELECT confirmed_at, COALESCE(array_length(recovery_codes, 1), 0)::int FROM user_totp WHERE user_id = $1",
        )
        .bind(user.user_id)
        .fetch_optional(&state.pg)
        .await?;
    let (enrolled, confirmed, recovery_codes_remaining) = match row {
        Some((Some(_), n)) => (true, true, n),
        Some((None, n)) => (true, false, n),
        None => (false, false, 0),
    };
    Ok(Json(Status {
        enrolled,
        confirmed,
        recovery_codes_remaining,
    }))
}

// ── POST /enroll ────────────────────────────────────────────────

#[derive(Serialize)]
pub struct EnrollResponse {
    otpauth_uri: String,
    secret_base32: String,
    recovery_codes: Vec<String>,
}

async fn enroll(
    State(state): State<AppState>,
    user: SessionUser,
) -> Result<Json<EnrollResponse>, AppError> {
    // Look up username for QR label
    let username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(user.user_id)
        .fetch_one(&state.pg)
        .await?;

    let e = totp::enroll(&username).map_err(AppError::Internal)?;

    // Upsert pending enrollment. A confirmed 2FA row cannot be replaced
    // here; the user must prove possession via /disable first.
    let touched: Option<uuid::Uuid> = sqlx::query_scalar(
        r#"
        INSERT INTO user_totp (user_id, secret_encrypted, secret_nonce, recovery_codes, confirmed_at, last_used_step, created_at)
        VALUES ($1, $2, $3, $4, NULL, NULL, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            secret_encrypted = EXCLUDED.secret_encrypted,
            secret_nonce     = EXCLUDED.secret_nonce,
            recovery_codes   = EXCLUDED.recovery_codes,
            confirmed_at     = NULL,
            last_used_step   = NULL
        WHERE user_totp.confirmed_at IS NULL
        RETURNING user_id
        "#,
    )
    .bind(user.user_id)
    .bind(&e.secret_encrypted)
    .bind(&e.secret_nonce)
    .bind(&e.recovery_hashes)
    .fetch_optional(&state.pg)
    .await?;
    if touched.is_none() {
        return Err(AppError::BadRequest(
            "2FA already active; disable it before enrolling again".into(),
        ));
    }

    Ok(Json(EnrollResponse {
        otpauth_uri: e.otpauth_uri,
        secret_base32: e.raw_secret_b32,
        recovery_codes: e.recovery_codes_plain,
    }))
}

// ── POST /confirm ───────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CodeBody {
    code: String,
}

type TotpConfirmRow = (
    Vec<u8>,
    Vec<u8>,
    Option<i64>,
    Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>>,
);
type TotpChallengeRow = (
    uuid::Uuid,
    uuid::Uuid,
    Vec<u8>,
    Vec<u8>,
    Option<i64>,
    Vec<Vec<u8>>,
    Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>>,
);

async fn confirm(
    State(state): State<AppState>,
    user: SessionUser,
    Json(body): Json<CodeBody>,
) -> Result<StatusCode, AppError> {
    let row: Option<TotpConfirmRow> =
        sqlx::query_as(
            "SELECT secret_encrypted, secret_nonce, last_used_step, confirmed_at FROM user_totp WHERE user_id = $1",
        )
        .bind(user.user_id)
        .fetch_optional(&state.pg)
        .await?;
    let (secret, nonce, last_step, confirmed_at) =
        row.ok_or_else(|| AppError::BadRequest("no pending enrollment".into()))?;
    if confirmed_at.is_some() {
        return Err(AppError::BadRequest("already confirmed".into()));
    }

    let step = totp::verify_code(&secret, &nonce, &body.code, last_step)
        .map_err(|_| AppError::Unauthorized)?;

    sqlx::query(
        "UPDATE user_totp SET confirmed_at = NOW(), last_used_step = $1 WHERE user_id = $2",
    )
    .bind(step)
    .bind(user.user_id)
    .execute(&state.pg)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /challenge ─────────────────────────────────────────────
//
// This is the endpoint a session in `pending_2fa = true` calls to satisfy
// the second factor. We let it bypass the normal CurrentUser gate by
// reading the cookie directly, because the session loader skips attaching
// CurrentUser when pending_2fa is true (see middleware/session::layer).
// Actually — the session loader currently *does* attach CurrentUser
// regardless; we treat pending_2fa as a state the caller must clear, and
// admin extractor refuses to serve it. So this endpoint just runs as a
// normal authenticated handler.

async fn challenge(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CodeBody>,
) -> Result<StatusCode, AppError> {
    let raw = read_cookie(&headers).ok_or(AppError::Unauthorized)?;
    let hash = hash_token(&raw);

    // Find session + user's secret
    let row: Option<TotpChallengeRow> =
        sqlx::query_as(
            r#"
            SELECT s.id, s.user_id, t.secret_encrypted, t.secret_nonce, t.last_used_step, t.recovery_codes, t.confirmed_at
            FROM sessions s
            JOIN user_totp t ON t.user_id = s.user_id
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = $1
              AND s.revoked_at IS NULL
              AND s.expires_at > NOW()
              AND u.role <> 'suspended'
            "#,
        )
        .bind(&hash)
        .fetch_optional(&state.pg)
        .await?;
    let (session_id, user_id, secret, nonce, last_step, recovery_codes, confirmed_at) =
        row.ok_or(AppError::Unauthorized)?;
    if confirmed_at.is_none() {
        return Err(AppError::BadRequest("2FA not confirmed".into()));
    }

    let code = body.code.trim();
    // Try TOTP first, then fall back to recovery code.
    let ok = match totp::verify_code(&secret, &nonce, code, last_step) {
        Ok(step) => {
            let _ = sqlx::query("UPDATE user_totp SET last_used_step = $1 WHERE user_id = $2")
                .bind(step)
                .bind(user_id)
                .execute(&state.pg)
                .await;
            true
        }
        Err(_) => {
            // recovery code path: hash and find in user's array; if hit, remove it.
            let h = totp::hash_recovery(code);
            if recovery_codes.iter().any(|c| c == &h) {
                let _ = sqlx::query(
                    "UPDATE user_totp SET recovery_codes = array_remove(recovery_codes, $1) WHERE user_id = $2",
                )
                .bind(&h)
                .bind(user_id)
                .execute(&state.pg)
                .await;
                true
            } else {
                false
            }
        }
    };
    if !ok {
        return Err(AppError::Unauthorized);
    }

    sqlx::query("UPDATE sessions SET pending_2fa = false WHERE id = $1")
        .bind(session_id)
        .execute(&state.pg)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /disable ───────────────────────────────────────────────

async fn disable(
    State(state): State<AppState>,
    user: SessionUser,
    Json(body): Json<CodeBody>,
) -> Result<StatusCode, AppError> {
    let row: Option<(Vec<u8>, Vec<u8>, Option<i64>)> = sqlx::query_as(
        "SELECT secret_encrypted, secret_nonce, last_used_step FROM user_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL",
    )
    .bind(user.user_id)
    .fetch_optional(&state.pg)
    .await?;
    let (secret, nonce, last_step) = row.ok_or(AppError::NotFound)?;
    totp::verify_code(&secret, &nonce, &body.code, last_step)
        .map_err(|_| AppError::Unauthorized)?;
    sqlx::query("DELETE FROM user_totp WHERE user_id = $1")
        .bind(user.user_id)
        .execute(&state.pg)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

fn read_cookie(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    let prefix = format!("{SESSION_COOKIE}=");
    for part in raw.split(';') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix(&prefix) {
            return Some(rest.to_string());
        }
    }
    None
}
