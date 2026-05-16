// /api/v1/auth/* — magic-link authentication endpoints.
//
//   POST /auth/request          { email }                       → 204
//   GET  /auth/verify/:token                                    → 302 / (cookie set)
//   POST /auth/logout                                           → 204
//
// Token strategy: 32 random bytes → base64url → emailed to user (raw),
// SHA-256(raw) stored in DB. Lookup at verify-time hashes the presented
// token and compares — the raw value is never persisted.
//
// First user (empty `users` table) gets role='admin'. Subsequent users
// default to 'member'. Invite enforcement comes in Hafta 2.

use crate::{
    auth::{email::Sender, hash_token, new_token, token::*},
    errors::AppError,
    state::AppState,
};
use axum::{
    extract::{ConnectInfo, Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use redis::AsyncCommands;
use serde::Deserialize;
use std::net::SocketAddr;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/request", post(request_handler))
        .route("/verify/{token}", get(verify_handler))
        .route("/logout", post(logout_handler))
}

// ────────────────────────────────────────────────────────────────
//  POST /auth/request
// ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RequestBody {
    email: String,
}

pub async fn request_handler(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<RequestBody>,
) -> Result<StatusCode, AppError> {
    let email = body.email.trim().to_lowercase();
    if !is_email_shaped(&email) {
        return Err(AppError::BadRequest("invalid email".into()));
    }

    // ── Rate limit (Redis INCR + EXPIRE)
    let mut redis = state.redis.clone();
    let key = format!("rl:auth:request:{email}");
    let count: u32 = redis.incr(&key, 1u32).await?;
    if count == 1 {
        let _: () = redis.expire(&key, RATE_LIMIT_WINDOW_SECS as i64).await?;
    }
    if count > RATE_LIMIT_MAX {
        return Err(AppError::RateLimited);
    }

    // ── Generate token + persist hash
    let (raw, hash) = new_token().map_err(AppError::Internal)?;
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .chars()
        .take(255)
        .collect::<String>();
    let ip_str = peer.ip().to_string();

    sqlx::query(
        r#"
        INSERT INTO auth_tokens (token_hash, email, expires_at, ip, user_agent)
        VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval, $4::inet, $5)
        "#,
    )
    .bind(&hash)
    .bind(&email)
    .bind(MAGIC_LINK_TTL.as_secs().to_string())
    .bind(&ip_str)
    .bind(&ua)
    .execute(&state.pg)
    .await?;

    // ── Build verify URL + send mail
    let url = format!("{}/api/v1/auth/verify/{}", state.config.site_origin, raw);
    let sender = Sender::from_env();
    let body_text = format!(
        "Hoş geldin!\n\n\
         burncpu.com'a giriş için aşağıdaki linke tıkla (15 dakika geçerli):\n\n\
         {url}\n\n\
         Bu maili sen istemediysen, görmezden gel — token kullanılmaz, saklanmaz.\n\n\
         🐢 burncpu",
    );
    sender
        .send(&email, "burncpu.com giriş linki", &body_text)
        .await
        .map_err(AppError::Internal)?;

    tracing::info!(%email, "magic link issued");
    Ok(StatusCode::NO_CONTENT)
}

// ────────────────────────────────────────────────────────────────
//  GET /auth/verify/:token
// ────────────────────────────────────────────────────────────────

pub async fn verify_handler(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Response, AppError> {
    let hash = hash_token(&token);

    // ── Lookup unconsumed, unexpired token
    let email: Option<String> = sqlx::query_scalar(
        r#"
        SELECT email
        FROM auth_tokens
        WHERE token_hash = $1
          AND consumed_at IS NULL
          AND expires_at > NOW()
        "#,
    )
    .bind(&hash)
    .fetch_optional(&state.pg)
    .await?;

    let Some(email) = email else {
        return Err(AppError::Unauthorized);
    };

    // ── Mark consumed (one-shot)
    sqlx::query("UPDATE auth_tokens SET consumed_at = NOW() WHERE token_hash = $1")
        .bind(&hash)
        .execute(&state.pg)
        .await?;

    // ── Find or create user
    let user_id = upsert_user(&state, &email).await?;

    // ── Create session
    let (session_raw, session_hash) = new_token().map_err(AppError::Internal)?;
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .chars()
        .take(255)
        .collect::<String>();
    let ip_str = peer.ip().to_string();

    sqlx::query(
        r#"
        INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at)
        VALUES ($1, $2, $3::inet, $4, NOW() + ($5 || ' seconds')::interval)
        "#,
    )
    .bind(user_id)
    .bind(&session_hash)
    .bind(&ip_str)
    .bind(&ua)
    .bind(SESSION_TTL.as_secs().to_string())
    .execute(&state.pg)
    .await?;

    // ── Set cookie + redirect /
    let cookie = format!(
        "{SESSION_COOKIE}={session_raw}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age={}",
        SESSION_TTL.as_secs()
    );

    let mut response = Redirect::to("/").into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).unwrap());
    Ok(response)
}

// ────────────────────────────────────────────────────────────────
//  POST /auth/logout
// ────────────────────────────────────────────────────────────────

pub async fn logout_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    if let Some(raw) = read_session_cookie(&headers) {
        let hash = hash_token(&raw);
        sqlx::query(
            "UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL",
        )
        .bind(&hash)
        .execute(&state.pg)
        .await?;
    }

    let cookie =
        format!("{SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
    let mut response = StatusCode::NO_CONTENT.into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).unwrap());
    Ok(response)
}

// ── helpers ──────────────────────────────────────────────────────

fn is_email_shaped(s: &str) -> bool {
    let bytes = s.as_bytes();
    let at = bytes.iter().position(|&b| b == b'@');
    matches!(
        at,
        Some(i) if i > 0 && i < bytes.len() - 3 && bytes[i + 1..].contains(&b'.')
    )
}

fn read_session_cookie(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in raw.split(';') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix(&format!("{SESSION_COOKIE}=")) {
            return Some(rest.to_string());
        }
    }
    None
}

async fn upsert_user(state: &AppState, email: &str) -> Result<uuid::Uuid, AppError> {
    let existing: Option<uuid::Uuid> =
        sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
            .bind(email)
            .fetch_optional(&state.pg)
            .await?;
    if let Some(id) = existing {
        sqlx::query("UPDATE users SET last_seen_at = NOW() WHERE id = $1")
            .bind(id)
            .execute(&state.pg)
            .await?;
        return Ok(id);
    }

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&state.pg)
        .await
        .unwrap_or(0);
    let role = if total == 0 { "admin" } else { "member" };

    let username_base = derive_username(email);
    let username = unique_username(&state.pg, &username_base).await?;

    let id: uuid::Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO users (email, username, display_name, role, last_seen_at)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING id
        "#,
    )
    .bind(email)
    .bind(&username)
    .bind(&username)
    .bind(role)
    .fetch_one(&state.pg)
    .await?;

    tracing::info!(%email, %username, %role, "user created");
    Ok(id)
}

fn derive_username(email: &str) -> String {
    let local = email.split('@').next().unwrap_or("user");
    let mut s = local
        .chars()
        .map(|c| match c {
            'a'..='z' | '0'..='9' | '_' => c,
            'A'..='Z' => c.to_ascii_lowercase(),
            _ => '_',
        })
        .collect::<String>();
    if s.len() < 3 {
        s = format!("user_{s}");
    }
    s.chars().take(32).collect()
}

async fn unique_username(pg: &sqlx::PgPool, base: &str) -> Result<String, AppError> {
    for n in 0..1000 {
        let candidate = if n == 0 { base.to_string() } else { format!("{base}{n}") };
        let taken: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)",
        )
        .bind(&candidate)
        .fetch_one(pg)
        .await
        .unwrap_or(false);
        if !taken {
            return Ok(candidate);
        }
    }
    Err(AppError::Internal(anyhow::anyhow!(
        "no free username after 1000 tries"
    )))
}
