// /api/v1/feed — personal "home" timeline.
//
// Returns public posts from users the viewer follows, plus their own
// posts. Sorted newest-first, keyset paginated via `(before, before_id)`.
//
// Reuses posts::PostRow / PostView so the wire shape is identical to the
// public timeline (nested `author`, `viewer_reacted`, `viewer_bookmarked`)
// — the SPA renders both through the same <Post> component.
//
// Performance note: at scale this becomes the "fanout-on-read vs
// fanout-on-write" inflection point. Postgres `WHERE author_id = ANY(...)`
// on `posts_author_idx` is fine to ~1K followees / ~100K posts. Above
// that we'll precompute via materialized view or move to a feed cache.

use crate::{
    errors::AppError,
    middleware::session::CurrentUser,
    routes::posts::{PostRow, PostView, enrich_cached_previews},
    state::AppState,
};
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
    before_id: Option<Uuid>,
}

fn default_limit() -> i64 {
    50
}

#[derive(Serialize)]
pub struct FeedResponse {
    posts: Vec<PostView>,
    next_before: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_before_id: Option<Uuid>,
}

async fn home(
    State(state): State<AppState>,
    user: CurrentUser,
    Query(q): Query<FeedQuery>,
) -> Result<Json<FeedResponse>, AppError> {
    let limit = q.limit.clamp(1, 100);
    let before = q.before.unwrap_or_else(Utc::now);
    let before_id = q.before_id.unwrap_or_else(Uuid::nil);

    let rows: Vec<PostRow> = sqlx::query_as(
        r#"
        SELECT
            p.id, p.author_id, u.username, u.display_name, u.avatar_url,
            p.body, p.body_html, p.visibility, p.reply_to_id, p.content_warning,
            p.reactions_count, p.replies_count, p.created_at, p.edited_at,
            EXISTS(SELECT 1 FROM reactions r WHERE r.post_id = p.id AND r.user_id = $1) AS viewer_reacted,
            EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = $1) AS viewer_bookmarked
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.deleted_at IS NULL
          AND p.moderation_state = 'live'
          AND p.reply_to_id IS NULL
          AND p.visibility IN ('public', 'followers')
          AND ((p.created_at < $2) OR (p.created_at = $2 AND p.id < $4))
          AND (
              p.author_id = $1
              OR p.author_id IN (
                  SELECT followee_id FROM follows WHERE follower_id = $1
              )
              -- Followed topics: public posts carrying a hashtag the viewer
              -- follows. Resolved through the materialized post_hashtags index
              -- (migration 0024) — an indexed join instead of a per-row body
              -- regex rescanned for every followed tag on every feed page.
              OR (
                  p.visibility = 'public'
                  AND EXISTS (
                      SELECT 1
                      FROM hashtag_follows hf
                      JOIN post_hashtags ph ON ph.tag = hf.tag AND ph.post_id = p.id
                      WHERE hf.user_id = $1
                  )
              )
          )
          AND p.author_id NOT IN (
              SELECT blocked_id FROM user_blocks WHERE blocker_id = $1
              UNION
              SELECT blocker_id FROM user_blocks WHERE blocked_id = $1
              UNION
              SELECT muted_id FROM user_mutes WHERE muter_id = $1
          )
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $3
        "#,
    )
    .bind(user.user_id)
    .bind(before)
    .bind(limit)
    .bind(before_id)
    .fetch_all(&state.pg)
    .await?;

    let next = rows.last().map(|r| r.cursor());
    let mut posts: Vec<PostView> = rows.into_iter().map(PostRow::into_view).collect();
    enrich_cached_previews(&state, &mut posts).await;

    Ok(Json(FeedResponse {
        posts,
        next_before: next.map(|(t, _)| t),
        next_before_id: next.map(|(_, id)| id),
    }))
}
