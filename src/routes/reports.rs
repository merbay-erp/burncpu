// /api/v1/reports — moderation reports queue.
//
//   POST   /reports  { target_kind, target_id, reason, note? }  → 201
//   GET    /admin/reports ?open=1                                → list (admin)
//   PATCH  /admin/reports/{id} { resolution }                    → mark resolved (admin)

use crate::{
    errors::AppError,
    middleware::{auth_extractor::AdminUser, session::CurrentUser},
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch, post},
};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new().route("/", post(create))
}

pub fn admin_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/{id}", patch(resolve))
}

const REASONS: &[&str] = &["spam", "harassment", "illegal", "other"];
const RESOLUTIONS: &[&str] = &["no_action", "removed", "suspended", "other"];

#[derive(Deserialize)]
pub struct CreateBody {
    target_kind: String,
    target_id: Uuid,
    reason: String,
    note: Option<String>,
}

async fn create(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(b): Json<CreateBody>,
) -> Result<StatusCode, AppError> {
    if !matches!(b.target_kind.as_str(), "post" | "user" | "dm") {
        return Err(AppError::BadRequest("invalid target_kind".into()));
    }
    if !REASONS.contains(&b.reason.as_str()) {
        return Err(AppError::BadRequest(format!(
            "reason must be one of {}",
            REASONS.join(", ")
        )));
    }
    sqlx::query(
        r#"
        INSERT INTO reports (reporter_id, target_kind, target_id, reason, note)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(user.user_id)
    .bind(&b.target_kind)
    .bind(b.target_id)
    .bind(&b.reason)
    .bind(b.note.as_deref())
    .execute(&state.pg)
    .await?;
    Ok(StatusCode::CREATED)
}

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    open: Option<u8>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ReportRow {
    id: Uuid,
    reporter_username: String,
    target_kind: String,
    target_id: Uuid,
    reason: String,
    note: Option<String>,
    created_at: DateTime<Utc>,
    resolved_at: Option<DateTime<Utc>>,
    resolved_by_username: Option<String>,
    resolution: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    _a: AdminUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<ReportRow>>, AppError> {
    let only_open = matches!(q.open, Some(1));
    let rows: Vec<ReportRow> = sqlx::query_as(
        r#"
        SELECT
            r.id, ru.username AS reporter_username, r.target_kind, r.target_id,
            r.reason, r.note, r.created_at, r.resolved_at,
            su.username AS resolved_by_username, r.resolution
        FROM reports r
        JOIN users ru ON ru.id = r.reporter_id
        LEFT JOIN users su ON su.id = r.resolved_by
        WHERE ($1 = false OR r.resolved_at IS NULL)
        ORDER BY r.created_at DESC
        LIMIT 200
        "#,
    )
    .bind(only_open)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct ResolveBody {
    resolution: String,
}

async fn resolve(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(b): Json<ResolveBody>,
) -> Result<StatusCode, AppError> {
    if !RESOLUTIONS.contains(&b.resolution.as_str()) {
        return Err(AppError::BadRequest("invalid resolution".into()));
    }
    let n = sqlx::query(
        r#"
        UPDATE reports SET resolved_at = NOW(), resolved_by = $1, resolution = $2
        WHERE id = $3 AND resolved_at IS NULL
        "#,
    )
    .bind(admin.0.user_id)
    .bind(&b.resolution)
    .bind(id)
    .execute(&state.pg)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}
