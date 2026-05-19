// /api/v1/feed — personal "home" timeline.
//
// Returns public posts from users the viewer follows, plus their own
// posts. Sorted newest-first, keyset paginated via `before` cursor.
//
// Performance note: at scale this becomes the "fanout-on-read vs
// fanout-on-write" inflection point. Postgres `WHERE author_id = ANY(...)`
// on `posts_author_idx` is fine to ~1K followees / ~100K posts. Above
// that we'll precompute via materialized view or move to a feed cache.

use crate::{errors::AppError, middleware::session::CurrentUser, state::AppState};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::get,
};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(home))
}

#[derive(Deserialize)]
pub struct FeedQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    before: Option<DateTime<Utc>>,
}

fn default_limit() -> i64 {
    50
}

#[derive(Serialize, sqlx::FromRow)]
pub struct FeedPost {
    id: Uuid,
    author_id: Uuid,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
    body: String,
    body_html: String,
    reply_to_id: Option<Uuid>,
    reactions_count: i32,
    replies_count: i32,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct FeedResponse {
    posts: Vec<FeedPost>,
    next_before: Option<DateTime<Utc>>,
}

async fn home(
    State(state): State<AppState>,
    user: CurrentUser,
    Query(q): Query<FeedQuery>,
) -> Result<Json<FeedResponse>, AppError> {
    let limit = q.limit.clamp(1, 100);
    let before = q.before.unwrap_or_else(Utc::now);

    let rows: Vec<FeedPost> = sqlx::query_as(
        r#"
        SELECT
            p.id, p.author_id, u.username, u.display_name, u.avatar_url,
            p.body, p.body_html, p.reply_to_id,
            p.reactions_count, p.replies_count, p.created_at
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.deleted_at IS NULL
          AND p.moderation_state = 'live'
          AND p.visibility IN ('public', 'followers')
          AND p.created_at < $2
          AND (
              p.author_id = $1
              OR p.author_id IN (
                  SELECT followee_id FROM follows WHERE follower_id = $1
              )
          )
          AND p.author_id NOT IN (
              SELECT blocked_id FROM user_blocks WHERE blocker_id = $1
              UNION
              SELECT blocker_id FROM user_blocks WHERE blocked_id = $1
              UNION
              SELECT muted_id FROM user_mutes WHERE muter_id = $1
          )
        ORDER BY p.created_at DESC
        LIMIT $3
        "#,
    )
    .bind(user.user_id)
    .bind(before)
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;

    let next_before = rows.last().map(|r| r.created_at);

    Ok(Json(FeedResponse {
        posts: rows,
        next_before,
    }))
}
