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
    middleware::client_ip,
    state::AppState,
};
use chrono::{DateTime, Utc};
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
        .nest("/2fa", super::twofa::router())
}

// ────────────────────────────────────────────────────────────────
//  POST /auth/request
// ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RequestBody {
    email: String,
    #[serde(default)]
    invite: Option<String>,
}

pub async fn request_handler(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<RequestBody>,
) -> Result<StatusCode, AppError> {
    let email = body.email.trim().to_lowercase();
    let ua = read_ua(&headers);
    let ip_str = client_ip::extract(&headers, Some(&peer))
        .map(|i| i.to_string())
        .unwrap_or_default();

    if !is_email_shaped(&email) {
        log_attempt(&state, None, "request", "invalid", &ip_str, &ua, None).await;
        return Err(AppError::BadRequest("invalid email".into()));
    }

    // ── Rate limit per-(IP, email) — prevents single attacker mailing many
    let mut redis = state.redis.clone();
    let key = format!("rl:auth:request:{ip_str}:{email}");
    let count: u32 = redis.incr(&key, 1u32).await?;
    if count == 1 {
        let _: () = redis.expire(&key, RATE_LIMIT_WINDOW_SECS as i64).await?;
    }
    if count > RATE_LIMIT_MAX {
        log_attempt(&state, Some(&email), "request", "rate_limited", &ip_str, &ua, None).await;
        return Err(AppError::RateLimited);
    }

    // ── Invite gating (only when INVITES_REQUIRED and email is new)
    if state.config.invites_required {
        let user_exists: Option<bool> =
            sqlx::query_scalar("SELECT TRUE FROM users WHERE email = $1")
                .bind(&email)
                .fetch_optional(&state.pg)
                .await?;
        if user_exists.is_none() {
            // New email → must present a valid, unredeemed, unexpired invite
            let code = body.invite.as_deref().unwrap_or("").trim();
            if code.is_empty() {
                log_attempt(&state, Some(&email), "request", "invalid", &ip_str, &ua, None).await;
                return Err(AppError::BadRequest("invite code required".into()));
            }
            let valid: Option<bool> = sqlx::query_scalar(
                r#"
                SELECT TRUE FROM invites
                WHERE code = $1 AND redeemed_at IS NULL AND expires_at > NOW()
                "#,
            )
            .bind(code)
            .fetch_optional(&state.pg)
            .await?;
            if valid.is_none() {
                log_attempt(&state, Some(&email), "request", "invalid", &ip_str, &ua, None).await;
                return Err(AppError::BadRequest("invite invalid or expired".into()));
            }
        }
    }

    // ── Generate token + persist hash (carry invite for verify-time consume)
    let (raw, hash) = new_token().map_err(AppError::Internal)?;

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

    // Stash invite code in Redis so verify_handler can mark it consumed.
    // Keyed by token hash; TTL matches the magic link.
    if let Some(code) = body.invite.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        let mut r = state.redis.clone();
        let key = format!("invite:pending:{}", hex(&hash));
        let _: () = r.set_ex(&key, code, MAGIC_LINK_TTL.as_secs()).await?;
    }

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

    log_attempt(&state, Some(&email), "request", "ok", &ip_str, &ua, None).await;
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
    let ua = read_ua(&headers);
    let ip_str = client_ip::extract(&headers, Some(&peer))
        .map(|i| i.to_string())
        .unwrap_or_default();

    // ── Lookup token (any state — we want to distinguish expired/consumed)
    let row: Option<(String, Option<chrono::DateTime<chrono::Utc>>, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as(
            r#"
            SELECT email, consumed_at, expires_at
            FROM auth_tokens
            WHERE token_hash = $1
            "#,
        )
        .bind(&hash)
        .fetch_optional(&state.pg)
        .await?;

    let (email, consumed_at, expires_at) = match row {
        Some(t) => t,
        None => {
            log_attempt(&state, None, "verify", "invalid", &ip_str, &ua, None).await;
            return Err(AppError::Unauthorized);
        }
    };
    if consumed_at.is_some() {
        log_attempt(&state, Some(&email), "verify", "consumed", &ip_str, &ua, None).await;
        return Err(AppError::Unauthorized);
    }
    if expires_at < chrono::Utc::now() {
        log_attempt(&state, Some(&email), "verify", "expired", &ip_str, &ua, None).await;
        return Err(AppError::Unauthorized);
    }

    // ── Mark consumed (one-shot)
    sqlx::query("UPDATE auth_tokens SET consumed_at = NOW() WHERE token_hash = $1")
        .bind(&hash)
        .execute(&state.pg)
        .await?;

    // ── Pull pending invite code (if any) from Redis and consume on signup
    let pending_invite: Option<String> = {
        let mut r = state.redis.clone();
        let key = format!("invite:pending:{}", hex(&hash));
        let v: Option<String> = r.get(&key).await.ok().flatten();
        if v.is_some() {
            let _: redis::RedisResult<()> = r.del(&key).await;
        }
        v
    };

    // ── Find or create user (invited_by from pending invite)
    let user_id = upsert_user(&state, &email, pending_invite.as_deref(), &state.pg).await?;

    // ── Create session
    let (session_raw, session_hash) = new_token().map_err(AppError::Internal)?;

    // If the user has confirmed TOTP, the new session starts in
    // pending_2fa state and admin endpoints refuse to serve it until
    // /auth/2fa/challenge clears the flag.
    let has_totp: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL)",
    )
    .bind(user_id)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(false);

    sqlx::query(
        r#"
        INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at, last_seen_at, last_seen_ip, last_seen_ua, pending_2fa)
        VALUES ($1, $2, $3::inet, $4, NOW() + ($5 || ' seconds')::interval, NOW(), $3::inet, $4, $6)
        "#,
    )
    .bind(user_id)
    .bind(&session_hash)
    .bind(&ip_str)
    .bind(&ua)
    .bind(SESSION_TTL.as_secs().to_string())
    .bind(has_totp)
    .execute(&state.pg)
    .await?;

    log_attempt(&state, Some(&email), "verify", "ok", &ip_str, &ua, Some(user_id)).await;

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

fn read_ua(headers: &HeaderMap) -> String {
    headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .chars()
        .take(255)
        .collect::<String>()
}

/// Best-effort write to `login_attempts`. Never fails the request — auth
/// must not 500 just because forensics logging hit a DB hiccup.
async fn log_attempt(
    state: &AppState,
    email: Option<&str>,
    kind: &str,
    outcome: &str,
    ip: &str,
    ua: &str,
    user_id: Option<uuid::Uuid>,
) {
    let r = sqlx::query(
        r#"
        INSERT INTO login_attempts (email, kind, outcome, ip, user_agent, user_id)
        VALUES ($1, $2, $3, $4::inet, $5, $6)
        "#,
    )
    .bind(email)
    .bind(kind)
    .bind(outcome)
    .bind(if ip.is_empty() { None } else { Some(ip) })
    .bind(ua)
    .bind(user_id)
    .execute(&state.pg)
    .await;
    if let Err(e) = r {
        tracing::warn!(?e, kind, outcome, "login_attempts insert failed");
    }
}

// Touch chrono types so the import isn't dead if verify path changes.
#[allow(dead_code)]
fn _t(_d: DateTime<Utc>) {}

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

async fn upsert_user(
    state: &AppState,
    email: &str,
    invite_code: Option<&str>,
    pg: &sqlx::PgPool,
) -> Result<uuid::Uuid, AppError> {
    let existing: Option<uuid::Uuid> =
        sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
            .bind(email)
            .fetch_optional(pg)
            .await?;
    if let Some(id) = existing {
        sqlx::query("UPDATE users SET last_seen_at = NOW() WHERE id = $1")
            .bind(id)
            .execute(pg)
            .await?;
        return Ok(id);
    }

    // Admin role is *only* granted to BOOTSTRAP_ADMIN_EMAIL. If unset, no
    // signup ever becomes admin (admins must be promoted manually via DB).
    // This removes the "first signup wins" race that previously made the
    // first user to ever hit /auth/request the platform admin.
    let role = match state.config.bootstrap_admin_email.as_deref() {
        Some(allowed) if allowed == email => "admin",
        _ => "member",
    };

    // If signup carries a valid invite, resolve inviter and mark redeemed.
    let inviter: Option<uuid::Uuid> = if let Some(code) = invite_code {
        sqlx::query_scalar(
            r#"
            SELECT inviter_id FROM invites
            WHERE code = $1 AND redeemed_at IS NULL AND expires_at > NOW()
            "#,
        )
        .bind(code)
        .fetch_optional(pg)
        .await?
    } else {
        None
    };

    let username_base = derive_username(email);
    let username = unique_username(pg, &username_base).await?;

    let id: uuid::Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO users (email, username, display_name, role, invited_by, last_seen_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id
        "#,
    )
    .bind(email)
    .bind(&username)
    .bind(&username)
    .bind(role)
    .bind(inviter)
    .fetch_one(pg)
    .await?;

    // Mark invite consumed
    if let Some(code) = invite_code {
        if inviter.is_some() {
            let _ = sqlx::query(
                "UPDATE invites SET redeemed_at = NOW(), redeemed_by = $1 WHERE code = $2",
            )
            .bind(id)
            .bind(code)
            .execute(pg)
            .await;
        }
    }

    tracing::info!(%email, %username, %role, ?inviter, "user created");
    let _ = state; // unused after refactor; kept for symmetric call site
    Ok(id)
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(s, "{:02x}", b);
    }
    s
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
