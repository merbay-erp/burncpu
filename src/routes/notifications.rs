// /api/v1/notifications — per-user inbox.
//
// Producers (post create / react / follow) call notify::* helpers which
// INSERT into the `notifications` table best-effort (failures are logged
// but never bubble up to the user — a missed badge bump is preferable to
// failing the underlying action).
//
//   GET   /notifications          → inbox (newest first, paginated, max 100)
//   GET   /notifications/count    → unread count for badge
//   PATCH /notifications/read     → bulk mark-all-read
//   PATCH /notifications/{id}/read

use crate::{
    errors::AppError,
    middleware::session::CurrentUser,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/count", get(unread_count))
        .route("/read", patch(mark_all_read))
        .route("/{id}/read", patch(mark_one_read))
}

// ── GET /notifications ──────────────────────────────────────────

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    before: Option<DateTime<Utc>>,
    #[serde(default)]
    unread_only: Option<u8>,
}

fn default_limit() -> i64 {
    50
}

#[derive(Serialize, sqlx::FromRow)]
pub struct NotificationView {
    id: Uuid,
    kind: String,
    actor_id: Option<Uuid>,
    actor_username: Option<String>,
    target_kind: String,
    target_id: Uuid,
    metadata: Option<JsonValue>,
    read_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct ListResponse {
    notifications: Vec<NotificationView>,
    next_before: Option<DateTime<Utc>>,
}

async fn list(
    State(state): State<AppState>,
    user: CurrentUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<ListResponse>, AppError> {
    let limit = q.limit.clamp(1, 100);
    let before = q.before.unwrap_or_else(Utc::now);
    let only_unread = matches!(q.unread_only, Some(1));

    let rows: Vec<NotificationView> = sqlx::query_as(
        r#"
        SELECT
            n.id, n.kind, n.actor_id, u.username AS actor_username,
            n.target_kind, n.target_id, n.metadata, n.read_at, n.created_at
        FROM notifications n
        LEFT JOIN users u ON u.id = n.actor_id
        WHERE n.user_id = $1
          AND n.created_at < $2
          AND ($3 = false OR n.read_at IS NULL)
        ORDER BY n.created_at DESC
        LIMIT $4
        "#,
    )
    .bind(user.user_id)
    .bind(before)
    .bind(only_unread)
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;

    let next_before = rows.last().map(|r| r.created_at);
    Ok(Json(ListResponse {
        notifications: rows,
        next_before,
    }))
}

// ── GET /notifications/count ────────────────────────────────────

#[derive(Serialize)]
pub struct CountResponse {
    unread: i64,
}

async fn unread_count(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<CountResponse>, AppError> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL",
    )
    .bind(user.user_id)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(0);
    Ok(Json(CountResponse { unread: n }))
}

// ── PATCH /notifications/read ───────────────────────────────────

async fn mark_all_read(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<StatusCode, AppError> {
    sqlx::query(
        "UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL",
    )
    .bind(user.user_id)
    .execute(&state.pg)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── PATCH /notifications/{id}/read ──────────────────────────────

async fn mark_one_read(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let n = sqlx::query(
        "UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND read_at IS NULL",
    )
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

// ─── producer helpers ───────────────────────────────────────────
//
// Best-effort: callers `let _ = notify::xxx().await;` and never bubble.
// Skip self-actions (you don't notify yourself).

pub async fn notify(
    state: &AppState,
    user_id: Uuid,
    actor_id: Option<Uuid>,
    kind: &str,
    target_kind: &str,
    target_id: Uuid,
    metadata: Option<JsonValue>,
) {
    if Some(user_id) == actor_id {
        return;
    }
    let r = sqlx::query(
        r#"
        INSERT INTO notifications (user_id, kind, actor_id, target_kind, target_id, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(user_id)
    .bind(kind)
    .bind(actor_id)
    .bind(target_kind)
    .bind(target_id)
    .bind(metadata)
    .execute(&state.pg)
    .await;
    if let Err(e) = r {
        tracing::warn!(?e, kind, "notification insert failed");
    }
}
