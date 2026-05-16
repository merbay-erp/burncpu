// /api/v1/bookmarks — private "save for later" list.
//
//   GET    /bookmarks               → viewer's bookmarked posts (newest first)
//   POST   /bookmarks/{post_id}     → bookmark (idempotent)
//   DELETE /bookmarks/{post_id}     → unbookmark
//
// No notification fired — bookmarks are private to the viewer.

use crate::{
    errors::AppError,
    middleware::session::CurrentUser,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Serialize;
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/{post_id}", post(add).delete(remove))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct BookmarkedPost {
    id: Uuid,
    author_id: Uuid,
    author_username: String,
    author_display_name: String,
    body: String,
    body_html: String,
    reactions_count: i32,
    replies_count: i32,
    created_at: DateTime<Utc>,
    bookmarked_at: DateTime<Utc>,
}

async fn list(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<Vec<BookmarkedPost>>, AppError> {
    let rows: Vec<BookmarkedPost> = sqlx::query_as(
        r#"
        SELECT
            p.id, p.author_id, u.username AS author_username,
            u.display_name AS author_display_name,
            p.body, p.body_html, p.reactions_count, p.replies_count,
            p.created_at, b.created_at AS bookmarked_at
        FROM bookmarks b
        JOIN posts p ON p.id = b.post_id
        JOIN users u ON u.id = p.author_id
        WHERE b.user_id = $1
          AND p.deleted_at IS NULL
          AND p.moderation_state = 'live'
        ORDER BY b.created_at DESC
        LIMIT 200
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

async fn add(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(post_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let exists: Option<bool> = sqlx::query_scalar(
        "SELECT TRUE FROM posts WHERE id = $1 AND deleted_at IS NULL AND moderation_state = 'live'",
    )
    .bind(post_id)
    .fetch_optional(&state.pg)
    .await?;
    if exists.is_none() {
        return Err(AppError::NotFound);
    }
    sqlx::query(
        "INSERT INTO bookmarks (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(user.user_id)
    .bind(post_id)
    .execute(&state.pg)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(post_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    sqlx::query("DELETE FROM bookmarks WHERE user_id = $1 AND post_id = $2")
        .bind(user.user_id)
        .bind(post_id)
        .execute(&state.pg)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
