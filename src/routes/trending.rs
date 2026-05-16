// /api/v1/trending — discovery surface.
//
//   GET /trending/hashtags ?window=24h    → hashtag → count, last 24h
//   GET /trending/posts    ?window=24h    → most-reacted public posts, last 24h
//
// Cheap implementation: scan recent posts in Postgres. At scale we'd
// precompute hourly into a materialized view; for now read-time is fine.

use crate::{errors::AppError, state::AppState};
use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/hashtags", get(hashtags))
        .route("/posts", get(posts))
}

#[derive(Deserialize)]
pub struct WindowQuery {
    #[serde(default = "default_window")]
    window: String,
    #[serde(default = "default_limit")]
    limit: i64,
}
fn default_window() -> String { "24h".into() }
fn default_limit() -> i64 { 20 }

fn parse_window(s: &str) -> chrono::Duration {
    let s = s.trim().to_lowercase();
    let (num, unit) = s.split_at(s.len().saturating_sub(1));
    let n: i64 = num.parse().unwrap_or(24);
    match unit {
        "m" => chrono::Duration::minutes(n),
        "h" => chrono::Duration::hours(n),
        "d" => chrono::Duration::days(n),
        _ => chrono::Duration::hours(24),
    }
}

#[derive(Serialize, sqlx::FromRow)]
pub struct TagCount {
    tag: String,
    count: i64,
}

async fn hashtags(
    State(state): State<AppState>,
    Query(q): Query<WindowQuery>,
) -> Result<Json<Vec<TagCount>>, AppError> {
    let since = Utc::now() - parse_window(&q.window);
    let limit = q.limit.clamp(1, 100);
    // Postgres regex extraction. Same rules as the Rust extractor: 2-32
    // chars, lowercase, alphanumeric or _. The `[a-z0-9_]{2,32}` regex
    // makes the same character-class commitment.
    let rows: Vec<TagCount> = sqlx::query_as(
        r#"
        SELECT tag, COUNT(*)::bigint AS count FROM (
            SELECT lower(unnest(regexp_matches(body, '(?<![[:alnum:]_])#([a-z0-9_]{2,32})', 'g'))) AS tag
            FROM posts
            WHERE deleted_at IS NULL
              AND moderation_state = 'live'
              AND visibility = 'public'
              AND created_at > $1
        ) m
        GROUP BY tag
        ORDER BY count DESC, tag ASC
        LIMIT $2
        "#,
    )
    .bind(since)
    .bind(limit)
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();
    Ok(Json(rows))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct TrendingPost {
    id: Uuid,
    author_id: Uuid,
    author_username: String,
    author_display_name: String,
    body: String,
    body_html: String,
    reactions_count: i32,
    replies_count: i32,
    created_at: DateTime<Utc>,
}

async fn posts(
    State(state): State<AppState>,
    Query(q): Query<WindowQuery>,
) -> Result<Json<Vec<TrendingPost>>, AppError> {
    let since = Utc::now() - parse_window(&q.window);
    let limit = q.limit.clamp(1, 50);
    let rows: Vec<TrendingPost> = sqlx::query_as(
        r#"
        SELECT p.id, p.author_id, u.username AS author_username,
               u.display_name AS author_display_name,
               p.body, p.body_html, p.reactions_count, p.replies_count, p.created_at
        FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.deleted_at IS NULL
          AND p.moderation_state = 'live'
          AND p.visibility = 'public'
          AND p.created_at > $1
        ORDER BY (p.reactions_count + p.replies_count) DESC, p.created_at DESC
        LIMIT $2
        "#,
    )
    .bind(since)
    .bind(limit)
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();
    Ok(Json(rows))
}
