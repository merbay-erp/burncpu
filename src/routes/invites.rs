// /api/v1/invites — invite-only signup.
//
//   POST   /invites              → create code (auth, 5/day limit per inviter)
//   GET    /invites              → list your own pending + spent invites
//   GET    /invites/{code}       → validate code (public, returns inviter username + expiry)
//   DELETE /invites/{code}       → revoke an unredeemed code you own
//
// The code is generated as 12 random base32 chars (lowercase, no padding,
// chars subset of [0-9 a-z] minus easily-confused ones). Stored as the
// primary key — no separate hash. Codes are single-use; an invite consumed
// during /auth/verify gets `redeemed_at` set.

use crate::{config::Config, errors::AppError, middleware::session::CurrentUser, state::AppState};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
};
use rand::RngCore;
use serde::Serialize;
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(create).get(list_mine))
        .route("/{code}", get(check).delete(revoke))
}

const INVITE_TTL_DAYS: i64 = 14;
const INVITE_DAILY_LIMIT: i64 = 5;

// ── Generate ────────────────────────────────────────────────────

fn gen_code() -> String {
    // ~60 bits of entropy, 12 chars. Crockford-ish alphabet minus
    // ambiguous (0/o/i/l/1).
    const ALPHA: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    let mut buf = [0u8; 12];
    rng.fill_bytes(&mut buf);
    buf.iter()
        .map(|b| ALPHA[(*b as usize) % ALPHA.len()] as char)
        .collect()
}

// ── POST /invites ───────────────────────────────────────────────

#[derive(Serialize)]
pub struct InviteCreated {
    code: String,
    url: String,
    expires_at: DateTime<Utc>,
}

async fn create(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<InviteCreated>, AppError> {
    // Per-day cap so a single account can't flood invites.
    let used_today: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM invites
        WHERE inviter_id = $1 AND created_at > NOW() - interval '24 hours'
        "#,
    )
    .bind(user.user_id)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(0);
    if used_today >= INVITE_DAILY_LIMIT {
        return Err(AppError::RateLimited);
    }

    let code = gen_code();
    let expires_at: DateTime<Utc> = sqlx::query_scalar(
        r#"
        INSERT INTO invites (code, inviter_id, expires_at)
        VALUES ($1, $2, NOW() + ($3 || ' days')::interval)
        RETURNING expires_at
        "#,
    )
    .bind(&code)
    .bind(user.user_id)
    .bind(INVITE_TTL_DAYS.to_string())
    .fetch_one(&state.pg)
    .await?;

    let url = format!("{}/invite/{}", state.config.site_origin, code);
    Ok(Json(InviteCreated {
        code,
        url,
        expires_at,
    }))
}

// ── GET /invites ────────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
pub struct InviteBrief {
    code: String,
    expires_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
    redeemed_at: Option<DateTime<Utc>>,
    redeemed_by: Option<Uuid>,
}

async fn list_mine(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<Vec<InviteBrief>>, AppError> {
    let rows: Vec<InviteBrief> = sqlx::query_as(
        r#"
        SELECT code, expires_at, created_at, redeemed_at, redeemed_by
        FROM invites WHERE inviter_id = $1
        ORDER BY created_at DESC
        LIMIT 50
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ── GET /invites/{code} ─────────────────────────────────────────

#[derive(Serialize)]
pub struct InviteCheck {
    code: String,
    valid: bool,
    reason: Option<&'static str>,
    inviter_username: Option<String>,
    expires_at: Option<DateTime<Utc>>,
}

async fn check(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<InviteCheck>, AppError> {
    let row: Option<(DateTime<Utc>, Option<DateTime<Utc>>, String)> = sqlx::query_as(
        r#"
        SELECT i.expires_at, i.redeemed_at, u.username
        FROM invites i JOIN users u ON u.id = i.inviter_id
        WHERE i.code = $1
        "#,
    )
    .bind(&code)
    .fetch_optional(&state.pg)
    .await?;

    let (valid, reason, inviter, expires) = match row {
        None => (false, Some("not_found"), None, None),
        Some((expires_at, Some(_), inviter)) => (
            false,
            Some("already_redeemed"),
            Some(inviter),
            Some(expires_at),
        ),
        Some((expires_at, None, inviter)) => {
            if expires_at < Utc::now() {
                (false, Some("expired"), Some(inviter), Some(expires_at))
            } else {
                (true, None, Some(inviter), Some(expires_at))
            }
        }
    };

    Ok(Json(InviteCheck {
        code,
        valid,
        reason,
        inviter_username: inviter,
        expires_at: expires,
    }))
}

// ── DELETE /invites/{code} ──────────────────────────────────────

async fn revoke(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(code): Path<String>,
) -> Result<StatusCode, AppError> {
    let rows = sqlx::query(
        r#"
        DELETE FROM invites
        WHERE code = $1 AND inviter_id = $2 AND redeemed_at IS NULL
        "#,
    )
    .bind(&code)
    .bind(user.user_id)
    .execute(&state.pg)
    .await?
    .rows_affected();

    if rows == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

// Touch Config so the unused-import lint is silent if we end up not using
// it in a slim revision later.
#[allow(dead_code)]
fn _touch(_c: &Config) {}
