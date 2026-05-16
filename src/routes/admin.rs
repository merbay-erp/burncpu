// /api/v1/admin — admin-only moderation surface.
//
// Every state-changing action writes a row to `moderation_log` so we have
// an append-only record of who did what, when, and why. The `actor_kind`
// is always 'admin' here; AI-driven decisions will land here later under
// 'ai' / 'system'.
//
// Endpoints:
//   GET    /admin/posts?state=live|quarantine|removed|all  → recent posts
//   PATCH  /admin/posts/{id}                               → change moderation_state (+reason)
//   GET    /admin/users                                    → recent + counts
//   PATCH  /admin/users/{id}                               → suspend / unsuspend (role)
//   GET    /admin/login_attempts?outcome=...               → recent failures
//   GET    /admin/audit?status_min=400                     → recent error responses
//   GET    /admin/sessions?flagged=1                       → flagged (hijack-suspected) sessions
//   GET    /admin/moderation_log                           → recent actions

use crate::{
    errors::AppError,
    middleware::auth_extractor::AdminUser,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/posts", get(list_posts))
        .route("/posts/{id}", patch(patch_post))
        .route("/users", get(list_users))
        .route("/users/{id}", patch(patch_user))
        .route("/login_attempts", get(login_attempts))
        .route("/audit", get(audit))
        .route("/sessions", get(sessions))
        .route("/moderation_log", get(mod_log))
}

// ── List posts ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct PostFilter {
    #[serde(default)]
    state: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    100
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminPostRow {
    id: Uuid,
    author_id: Uuid,
    author_username: String,
    body: String,
    visibility: String,
    moderation_state: String,
    spam_score: Option<i16>,
    reactions_count: i32,
    replies_count: i32,
    created_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
}

async fn list_posts(
    State(state): State<AppState>,
    _a: AdminUser,
    Query(q): Query<PostFilter>,
) -> Result<Json<Vec<AdminPostRow>>, AppError> {
    let limit = q.limit.clamp(1, 500);
    let state_filter = q.state.as_deref().unwrap_or("all");
    let rows: Vec<AdminPostRow> = sqlx::query_as(
        r#"
        SELECT
            p.id, p.author_id, u.username AS author_username,
            p.body, p.visibility, p.moderation_state, p.spam_score,
            p.reactions_count, p.replies_count, p.created_at, p.deleted_at
        FROM posts p JOIN users u ON u.id = p.author_id
        WHERE ($1 = 'all' OR p.moderation_state = $1)
        ORDER BY p.created_at DESC
        LIMIT $2
        "#,
    )
    .bind(state_filter)
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ── PATCH post mod state ────────────────────────────────────────

#[derive(Deserialize)]
pub struct PatchPost {
    moderation_state: String,
    #[serde(default)]
    reason: Option<String>,
}

async fn patch_post(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(input): Json<PatchPost>,
) -> Result<StatusCode, AppError> {
    if !matches!(input.moderation_state.as_str(), "live" | "quarantine" | "removed") {
        return Err(AppError::BadRequest("invalid state".into()));
    }
    let updated = sqlx::query(
        "UPDATE posts SET moderation_state = $1, updated_at = NOW() WHERE id = $2",
    )
    .bind(&input.moderation_state)
    .bind(id)
    .execute(&state.pg)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::NotFound);
    }
    log_mod(
        &state,
        "post",
        id,
        &format!("set_state:{}", input.moderation_state),
        Some(admin.0.user_id),
        input.reason.as_deref(),
        None,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

// ── List users ──────────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminUserRow {
    id: Uuid,
    username: String,
    email: String,
    display_name: String,
    role: String,
    created_at: DateTime<Utc>,
    last_seen_at: Option<DateTime<Utc>>,
    post_count: i64,
}

async fn list_users(
    State(state): State<AppState>,
    _a: AdminUser,
) -> Result<Json<Vec<AdminUserRow>>, AppError> {
    let rows: Vec<AdminUserRow> = sqlx::query_as(
        r#"
        SELECT
            u.id, u.username, u.email::text AS email, u.display_name, u.role,
            u.created_at, u.last_seen_at,
            (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND deleted_at IS NULL)::bigint AS post_count
        FROM users u
        ORDER BY u.created_at DESC
        LIMIT 500
        "#,
    )
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ── PATCH user (suspend / unsuspend) ────────────────────────────

#[derive(Deserialize)]
pub struct PatchUser {
    role: String,
    #[serde(default)]
    reason: Option<String>,
}

async fn patch_user(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(input): Json<PatchUser>,
) -> Result<StatusCode, AppError> {
    // Admin role promotion is NOT exposed via API — only suspend/member toggle.
    if !matches!(input.role.as_str(), "suspended" | "member") {
        return Err(AppError::BadRequest(
            "role must be 'suspended' or 'member' (admin granted only via env)".into(),
        ));
    }
    if id == admin.0.user_id {
        return Err(AppError::BadRequest("cannot modify own role".into()));
    }
    let updated = sqlx::query(
        "UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND role <> 'admin'",
    )
    .bind(&input.role)
    .bind(id)
    .execute(&state.pg)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::NotFound);
    }
    // Suspending also revokes all sessions so the user is logged out instantly.
    if input.role == "suspended" {
        let _ = sqlx::query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL")
            .bind(id)
            .execute(&state.pg)
            .await;
    }
    log_mod(
        &state,
        "user",
        id,
        &format!("set_role:{}", input.role),
        Some(admin.0.user_id),
        input.reason.as_deref(),
        None,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

// ── Recent login_attempts ───────────────────────────────────────

#[derive(Deserialize)]
pub struct AttemptFilter {
    outcome: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct LoginAttemptRow {
    email: Option<String>,
    kind: String,
    outcome: String,
    ip: Option<String>,
    user_agent: Option<String>,
    ts: DateTime<Utc>,
}

async fn login_attempts(
    State(state): State<AppState>,
    _a: AdminUser,
    Query(q): Query<AttemptFilter>,
) -> Result<Json<Vec<LoginAttemptRow>>, AppError> {
    let limit = q.limit.clamp(1, 500);
    let rows: Vec<LoginAttemptRow> = sqlx::query_as(
        r#"
        SELECT email::text, kind, outcome, host(ip)::text AS ip, user_agent, ts
        FROM login_attempts
        WHERE ($1::text IS NULL OR outcome = $1)
        ORDER BY ts DESC
        LIMIT $2
        "#,
    )
    .bind(q.outcome.as_deref())
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ── Audit log (error responses by default) ──────────────────────

#[derive(Deserialize)]
pub struct AuditFilter {
    #[serde(default)]
    status_min: Option<i16>,
    #[serde(default = "default_limit")]
    limit: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AuditRow {
    id: Uuid,
    method: String,
    path: String,
    status: i16,
    latency_ms: i32,
    ip: Option<String>,
    user_agent: Option<String>,
    user_id: Option<Uuid>,
    ts: DateTime<Utc>,
}

async fn audit(
    State(state): State<AppState>,
    _a: AdminUser,
    Query(q): Query<AuditFilter>,
) -> Result<Json<Vec<AuditRow>>, AppError> {
    let limit = q.limit.clamp(1, 500);
    let min = q.status_min.unwrap_or(0);
    let rows: Vec<AuditRow> = sqlx::query_as(
        r#"
        SELECT id, method, path, status, latency_ms,
               host(ip)::text AS ip, user_agent, user_id, ts
        FROM audit_log
        WHERE status >= $1
        ORDER BY ts DESC
        LIMIT $2
        "#,
    )
    .bind(min)
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ── Flagged sessions ────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
pub struct SessionRow {
    id: Uuid,
    user_id: Uuid,
    username: String,
    ip: Option<String>,
    user_agent: Option<String>,
    last_seen_ip: Option<String>,
    last_seen_ua: Option<String>,
    last_seen_at: DateTime<Utc>,
    flagged_at: Option<DateTime<Utc>>,
    expires_at: DateTime<Utc>,
    revoked_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
pub struct SessionFilter {
    #[serde(default)]
    flagged: Option<u8>,
}

async fn sessions(
    State(state): State<AppState>,
    _a: AdminUser,
    Query(q): Query<SessionFilter>,
) -> Result<Json<Vec<SessionRow>>, AppError> {
    let only_flagged = matches!(q.flagged, Some(1));
    let rows: Vec<SessionRow> = sqlx::query_as(
        r#"
        SELECT
            s.id, s.user_id, u.username,
            host(s.ip)::text AS ip,
            s.user_agent,
            host(s.last_seen_ip)::text AS last_seen_ip,
            s.last_seen_ua,
            s.last_seen_at,
            s.flagged_at,
            s.expires_at,
            s.revoked_at
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE ($1 = false OR s.flagged_at IS NOT NULL)
        ORDER BY COALESCE(s.flagged_at, s.last_seen_at) DESC
        LIMIT 200
        "#,
    )
    .bind(only_flagged)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ── Moderation log ──────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
pub struct ModLogRow {
    id: Uuid,
    target_kind: String,
    target_id: Uuid,
    action: String,
    actor_kind: String,
    actor_id: Option<Uuid>,
    reason: Option<String>,
    ai_score: Option<i16>,
    created_at: DateTime<Utc>,
}

async fn mod_log(
    State(state): State<AppState>,
    _a: AdminUser,
) -> Result<Json<Vec<ModLogRow>>, AppError> {
    let rows: Vec<ModLogRow> = sqlx::query_as(
        r#"
        SELECT id, target_kind, target_id, action, actor_kind, actor_id, reason, ai_score, created_at
        FROM moderation_log
        ORDER BY created_at DESC
        LIMIT 200
        "#,
    )
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ── log helper ──────────────────────────────────────────────────

async fn log_mod(
    state: &AppState,
    target_kind: &str,
    target_id: Uuid,
    action: &str,
    actor_id: Option<Uuid>,
    reason: Option<&str>,
    ai_score: Option<i16>,
) {
    let r = sqlx::query(
        r#"
        INSERT INTO moderation_log (target_kind, target_id, action, actor_kind, actor_id, reason, ai_score)
        VALUES ($1, $2, $3, 'admin', $4, $5, $6)
        "#,
    )
    .bind(target_kind)
    .bind(target_id)
    .bind(action)
    .bind(actor_id)
    .bind(reason)
    .bind(ai_score)
    .execute(&state.pg)
    .await;
    if let Err(e) = r {
        tracing::warn!(?e, action, "moderation_log insert failed");
    }
}
