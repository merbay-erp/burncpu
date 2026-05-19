// /api/v1/users/{username}/block + /mute — A→B safety actions.
//
//   POST   /users/{u}/block   → 204 (idempotent). Also drops mutual follows.
//   DELETE /users/{u}/block   → 204
//   POST   /users/{u}/mute    → 204 (idempotent)
//   DELETE /users/{u}/mute    → 204
//   GET    /me/blocks         → list of blocked usernames
//   GET    /me/mutes          → list of muted usernames

use crate::{errors::AppError, middleware::session::CurrentUser, state::AppState};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::Serialize;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/blocks", get(list_blocks))
        .route("/me/mutes", get(list_mutes))
        .route("/{username}/block", post(block).delete(unblock))
        .route("/{username}/mute", post(mute).delete(unmute))
}

async fn lookup(state: &AppState, username: &str) -> Result<Uuid, AppError> {
    sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE username = $1")
        .bind(username)
        .fetch_optional(&state.pg)
        .await?
        .ok_or(AppError::NotFound)
}

async fn block(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(username): Path<String>,
) -> Result<StatusCode, AppError> {
    let target = lookup(&state, &username).await?;
    if target == user.user_id {
        return Err(AppError::BadRequest("cannot block yourself".into()));
    }
    let mut tx = state.pg.begin().await?;
    sqlx::query(
        "INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(user.user_id)
    .bind(target)
    .execute(&mut *tx)
    .await?;
    // Drop both follow directions
    sqlx::query(
        "DELETE FROM follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)",
    )
    .bind(user.user_id)
    .bind(target)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn unblock(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(username): Path<String>,
) -> Result<StatusCode, AppError> {
    let target = lookup(&state, &username).await?;
    sqlx::query("DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2")
        .bind(user.user_id)
        .bind(target)
        .execute(&state.pg)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn mute(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(username): Path<String>,
) -> Result<StatusCode, AppError> {
    let target = lookup(&state, &username).await?;
    if target == user.user_id {
        return Err(AppError::BadRequest("cannot mute yourself".into()));
    }
    sqlx::query(
        "INSERT INTO user_mutes (muter_id, muted_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(user.user_id)
    .bind(target)
    .execute(&state.pg)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn unmute(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(username): Path<String>,
) -> Result<StatusCode, AppError> {
    let target = lookup(&state, &username).await?;
    sqlx::query("DELETE FROM user_mutes WHERE muter_id = $1 AND muted_id = $2")
        .bind(user.user_id)
        .bind(target)
        .execute(&state.pg)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Brief {
    username: String,
    display_name: String,
}

async fn list_blocks(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<Vec<Brief>>, AppError> {
    let rows: Vec<Brief> = sqlx::query_as(
        r#"
        SELECT u.username, u.display_name FROM user_blocks b
        JOIN users u ON u.id = b.blocked_id
        WHERE b.blocker_id = $1 ORDER BY b.created_at DESC
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

async fn list_mutes(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<Vec<Brief>>, AppError> {
    let rows: Vec<Brief> = sqlx::query_as(
        r#"
        SELECT u.username, u.display_name FROM user_mutes m
        JOIN users u ON u.id = m.muted_id
        WHERE m.muter_id = $1 ORDER BY m.created_at DESC
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}
