// /api/v1/trending — discovery surface.
//
//   GET /trending/hashtags ?window=24h    → hashtag → count, last 24h
//   GET /trending/posts    ?window=24h    → most-reacted public posts, last 24h
//
// Cheap implementation: scan recent posts in Postgres. At scale we'd
// precompute hourly into a materialized view; for now read-time is fine.

use crate::{errors::AppError, state::AppState};
use axum::{
    Router,
    extract::{Query, State},
    response::IntoResponse,
    routing::get,
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
fn default_window() -> String {
    "24h".into()
}
fn default_limit() -> i64 {
    20
}

fn parse_window(s: &str) -> chrono::Duration {
    let s = s.trim().to_lowercase();
    let (num, unit) = s.split_at(s.len().saturating_sub(1));
    // Clamp the magnitude: an unbounded value (e.g. `window=999999999d`) makes
    // `Utc::now() - Duration` overflow chrono's representable range, which
    // panics the handler. 1..=8760 of any unit stays comfortably in range.
    let n: i64 = num.parse().unwrap_or(24).clamp(1, 8760);
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
) -> Result<impl IntoResponse, AppError> {
    let limit = q.limit.clamp(1, 100);
    // Cap the window at ~7 days so trending never regex-scans more than that
    // slice of the public corpus (the scan is O(posts-in-window)); this also
    // bounds the cache key space. Result is viewer-independent → cache 5 min.
    let dur = parse_window(&q.window).min(chrono::Duration::hours(168));
    let since = Utc::now() - dur;
    let key = format!("tr:tags:{}m:l{}", dur.num_minutes(), limit);
    let compute = || async {
        // Postgres regex extraction. Same rules as the Rust extractor: 2-32
        // chars, lowercase, alphanumeric or _. Lowercase the body first so a tag
        // typed `#News` matches as `news` (the `[a-z0-9_]` class would otherwise
        // miss the capital N entirely and silently truncate the tag).
        let rows: Vec<TagCount> = sqlx::query_as(
        r#"
        -- Anti-gaming (P8): rank tags by the number of DISTINCT authors using them,
        -- not raw occurrences, and require at least 2 — so one account spamming a tag
        -- can't trend it. Accounts carrying recent moderation heat (current_heat, P2)
        -- are excluded so repeat offenders can't push a tag.
        SELECT tag, COUNT(DISTINCT author_id)::bigint AS count FROM (
            SELECT p.author_id,
                   unnest(regexp_matches(lower(body), '(?<![[:alnum:]_])#([a-z0-9_]{2,32})', 'g')) AS tag
            FROM posts p
            JOIN users u ON u.id = p.author_id
            WHERE p.deleted_at IS NULL
              AND p.moderation_state = 'live'
              AND p.visibility = 'public'
              AND p.created_at > $1
              AND u.role <> 'suspended'
              AND current_heat(u.heat_score, u.heat_updated_at) < 4
        ) m
        GROUP BY tag
        HAVING COUNT(DISTINCT author_id) >= 2
        ORDER BY count DESC, tag ASC
        LIMIT $2
        "#,
    )
    .bind(since)
    .bind(limit)
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();
        serde_json::to_string(&rows).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))
    };
    let json =
        crate::cache::read_through_json(&mut state.redis.clone(), &key, 300, compute).await?;
    Ok((
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        json,
    ))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct TrendingPost {
    id: Uuid,
    author_id: Uuid,
    author_username: String,
    author_display_name: String,
    author_avatar_url: Option<String>,
    body: String,
    body_html: String,
    reactions_count: i32,
    replies_count: i32,
    created_at: DateTime<Utc>,
}

async fn posts(
    State(state): State<AppState>,
    Query(q): Query<WindowQuery>,
) -> Result<impl IntoResponse, AppError> {
    let limit = q.limit.clamp(1, 50);
    let dur = parse_window(&q.window).min(chrono::Duration::hours(168));
    let since = Utc::now() - dur;
    let key = format!("tr:posts:{}m:l{}", dur.num_minutes(), limit);
    let compute = || async {
        let rows: Vec<TrendingPost> = sqlx::query_as(
            r#"
        SELECT p.id, p.author_id, u.username AS author_username,
               u.display_name AS author_display_name, u.avatar_url AS author_avatar_url,
               p.body, p.body_html, p.reactions_count, p.replies_count, p.created_at
        FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.deleted_at IS NULL
          AND p.moderation_state = 'live'
          AND p.visibility = 'public'
          AND p.created_at > $1
          AND u.role <> 'suspended'
          -- Anti-gaming (P8): the author must be at least 2 days old, and free of
          -- recent moderation heat (current_heat, P2) — a fresh sock-puppet ring or
          -- a flagged repeat offender can't trend. Trust-weighting the reactions
          -- themselves belongs in the at-scale materialized view noted above.
          AND u.created_at < NOW() - interval '48 hours'
          AND current_heat(u.heat_score, u.heat_updated_at) < 4
        ORDER BY (p.reactions_count + p.replies_count) DESC, p.created_at DESC
        LIMIT $2
        "#,
        )
        .bind(since)
        .bind(limit)
        .fetch_all(&state.pg)
        .await
        .unwrap_or_default();
        serde_json::to_string(&rows).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))
    };
    let json =
        crate::cache::read_through_json(&mut state.redis.clone(), &key, 300, compute).await?;
    Ok((
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        json,
    ))
}
