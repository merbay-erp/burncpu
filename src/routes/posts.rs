// /api/v1/posts — CRUD + public timeline.
//
//   POST   /posts            { body, visibility?, reply_to_id? } → 201 { post }
//   GET    /posts            ?limit=&before=                     → 200 { posts[] }
//   GET    /posts/:id                                            → 200 { post }
//   DELETE /posts/:id                                            → 204
//
// Auth: POST and DELETE require a valid session cookie (CurrentUser extractor).
// Anti-spam: per-user Redis rate limit (10 posts / 10 min). Per-IP rate limit
// on top, applied via tower layers in a future iteration.
//
// XSS: body stored as raw markdown, body_html is sanitized HTML cached at
// write time so reads are zero-cost. Sanitizer is restricted to a small
// whitelist (see content::render_markdown).

use crate::{
    content::render_markdown,
    errors::AppError,
    middleware::session::CurrentUser,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(create_post).get(timeline))
        .route("/{id}", get(get_post).delete(delete_post))
}

// ── Models ──────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct PostView {
    id: Uuid,
    author: AuthorView,
    body: String,
    body_html: String,
    visibility: String,
    reply_to_id: Option<Uuid>,
    reactions_count: i32,
    replies_count: i32,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct AuthorView {
    id: Uuid,
    username: String,
    display_name: String,
}

// ── POST /posts ─────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateBody {
    body: String,
    #[serde(default = "default_visibility")]
    visibility: String,
    reply_to_id: Option<Uuid>,
}

fn default_visibility() -> String {
    "public".to_string()
}

const MAX_POST_LEN: usize = 5000;
const POST_RATE_LIMIT_MAX: u32 = 10;
const POST_RATE_LIMIT_WINDOW_SECS: u64 = 600;

async fn create_post(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<CreateBody>,
) -> Result<impl IntoResponse, AppError> {
    let body = input.body.trim();
    if body.is_empty() {
        return Err(AppError::BadRequest("body required".into()));
    }
    if body.chars().count() > MAX_POST_LEN {
        return Err(AppError::BadRequest(format!(
            "body too long (max {MAX_POST_LEN} chars)"
        )));
    }
    if !matches!(input.visibility.as_str(), "public" | "followers" | "private") {
        return Err(AppError::BadRequest("invalid visibility".into()));
    }

    // Rate limit per-user
    let mut redis = state.redis.clone();
    let key = format!("rl:post:create:{}", user.user_id);
    let count: u32 = redis.incr(&key, 1u32).await?;
    if count == 1 {
        let _: () = redis
            .expire(&key, POST_RATE_LIMIT_WINDOW_SECS as i64)
            .await?;
    }
    if count > POST_RATE_LIMIT_MAX {
        return Err(AppError::RateLimited);
    }

    // Validate reply_to_id exists + is live
    if let Some(reply_id) = input.reply_to_id {
        let exists: Option<bool> = sqlx::query_scalar(
            r#"
            SELECT TRUE FROM posts
            WHERE id = $1 AND deleted_at IS NULL AND moderation_state = 'live'
            "#,
        )
        .bind(reply_id)
        .fetch_optional(&state.pg)
        .await?;
        if exists.is_none() {
            return Err(AppError::BadRequest("reply target not found".into()));
        }
    }

    let body_html = render_markdown(body);

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO posts (author_id, body, body_html, visibility, reply_to_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        "#,
    )
    .bind(user.user_id)
    .bind(body)
    .bind(&body_html)
    .bind(&input.visibility)
    .bind(input.reply_to_id)
    .fetch_one(&state.pg)
    .await?;

    // Bump parent reply count
    if let Some(reply_id) = input.reply_to_id {
        let _ = sqlx::query("UPDATE posts SET replies_count = replies_count + 1 WHERE id = $1")
            .bind(reply_id)
            .execute(&state.pg)
            .await;
    }

    let post = fetch_post(&state, id, Some(user.user_id)).await?;
    tracing::info!(user_id = %user.user_id, post_id = %id, "post created");
    Ok((StatusCode::CREATED, Json(post)))
}

// ── GET /posts (timeline) ───────────────────────────────────────

#[derive(Deserialize)]
pub struct TimelineQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    before: Option<DateTime<Utc>>,
}

fn default_limit() -> i64 {
    50
}

async fn timeline(
    State(state): State<AppState>,
    Query(q): Query<TimelineQuery>,
) -> Result<Json<TimelineResponse>, AppError> {
    let limit = q.limit.clamp(1, 100);
    let before = q.before.unwrap_or_else(Utc::now);

    let rows: Vec<PostRow> = sqlx::query_as(
        r#"
        SELECT
            p.id, p.author_id, u.username, u.display_name,
            p.body, p.body_html, p.visibility, p.reply_to_id,
            p.reactions_count, p.replies_count, p.created_at
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.visibility = 'public'
          AND p.moderation_state = 'live'
          AND p.deleted_at IS NULL
          AND p.created_at < $1
        ORDER BY p.created_at DESC
        LIMIT $2
        "#,
    )
    .bind(before)
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;

    let next_before = rows.last().map(|r| r.created_at);
    let posts = rows.into_iter().map(PostRow::into_view).collect();

    Ok(Json(TimelineResponse {
        posts,
        next_before,
    }))
}

#[derive(Serialize)]
pub struct TimelineResponse {
    posts: Vec<PostView>,
    next_before: Option<DateTime<Utc>>,
}

// ── GET /posts/:id ──────────────────────────────────────────────

async fn get_post(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<PostView>, AppError> {
    let view = fetch_post(&state, id, None).await?;
    Ok(Json(view))
}

// ── DELETE /posts/:id ───────────────────────────────────────────

async fn delete_post(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let author_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&state.pg)
    .await?;

    let author_id = author_id.ok_or(AppError::NotFound)?;
    if author_id != user.user_id && user.role != "admin" {
        return Err(AppError::Forbidden);
    }

    sqlx::query("UPDATE posts SET deleted_at = NOW() WHERE id = $1")
        .bind(id)
        .execute(&state.pg)
        .await?;

    tracing::info!(user_id = %user.user_id, post_id = %id, "post deleted");
    Ok(StatusCode::NO_CONTENT)
}

// ── helpers ─────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct PostRow {
    id: Uuid,
    author_id: Uuid,
    username: String,
    display_name: String,
    body: String,
    body_html: String,
    visibility: String,
    reply_to_id: Option<Uuid>,
    reactions_count: i32,
    replies_count: i32,
    created_at: DateTime<Utc>,
}

impl PostRow {
    fn into_view(self) -> PostView {
        PostView {
            id: self.id,
            author: AuthorView {
                id: self.author_id,
                username: self.username,
                display_name: self.display_name,
            },
            body: self.body,
            body_html: self.body_html,
            visibility: self.visibility,
            reply_to_id: self.reply_to_id,
            reactions_count: self.reactions_count,
            replies_count: self.replies_count,
            created_at: self.created_at,
        }
    }
}

async fn fetch_post(
    state: &AppState,
    id: Uuid,
    _viewer: Option<Uuid>,
) -> Result<PostView, AppError> {
    let row: Option<PostRow> = sqlx::query_as(
        r#"
        SELECT
            p.id, p.author_id, u.username, u.display_name,
            p.body, p.body_html, p.visibility, p.reply_to_id,
            p.reactions_count, p.replies_count, p.created_at
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.id = $1
          AND p.deleted_at IS NULL
          AND p.moderation_state = 'live'
        "#,
    )
    .bind(id)
    .fetch_optional(&state.pg)
    .await?;

    row.map(PostRow::into_view).ok_or(AppError::NotFound)
}
