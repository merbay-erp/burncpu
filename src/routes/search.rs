// /api/v1/search and /api/v1/hashtags — text + tag search.
//
//   GET /api/v1/search ?q=&tag=&limit=
//   GET /api/v1/hashtags/{tag} ?limit=
//   POST /api/v1/admin/reindex   (admin) — re-bulk-index all live public posts
//
// Returns Meilisearch's hit objects directly (highlight + tags + body).
// Anon-safe: filter is hardcoded to live + public; private/follower-only
// posts never leak via search.

use crate::{
    errors::AppError,
    middleware::auth_extractor::AdminUser,
    search::PostDoc,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(search))
        .route("/reindex", post(reindex))
}

pub fn hashtags_router() -> Router<AppState> {
    Router::new().route("/{tag}", get(by_hashtag))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    #[serde(default)]
    q: String,
    #[serde(default)]
    tag: Option<String>,
    #[serde(default = "default_limit")]
    limit: usize,
}

fn default_limit() -> usize {
    30
}

async fn search(
    State(state): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Value>, AppError> {
    let limit = q.limit.clamp(1, 100);
    let result = state
        .search
        .search_public(q.q.trim(), q.tag.as_deref(), limit)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct TagQuery {
    #[serde(default = "default_limit")]
    limit: usize,
}

async fn by_hashtag(
    State(state): State<AppState>,
    Path(tag): Path<String>,
    Query(q): Query<TagQuery>,
) -> Result<Json<Value>, AppError> {
    let limit = q.limit.clamp(1, 100);
    let result = state
        .search
        .search_public("", Some(&tag), limit)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    Ok(Json(result))
}

// ── Admin: backfill / re-index ──────────────────────────────────

#[derive(serde::Serialize)]
pub struct ReindexResult {
    indexed: usize,
}

async fn reindex(
    State(state): State<AppState>,
    _a: AdminUser,
) -> Result<Json<ReindexResult>, AppError> {
    // Pull all live + public posts; cap at 50k to avoid OOM. Above that
    // volume we'd want a paged background job — not yet needed.
    let rows: Vec<(Uuid, Uuid, String, String, DateTime<Utc>, i32, i32)> = sqlx::query_as(
        r#"
        SELECT p.id, p.author_id, u.username, p.body, p.created_at,
               p.reactions_count, p.replies_count
        FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.deleted_at IS NULL
          AND p.moderation_state = 'live'
          AND p.visibility = 'public'
        ORDER BY p.created_at DESC
        LIMIT 50000
        "#,
    )
    .fetch_all(&state.pg)
    .await?;

    let docs: Vec<PostDoc> = rows
        .into_iter()
        .map(|(id, author_id, username, body, created, rc, repc)| {
            PostDoc::from_parts(id, author_id, &username, &body, "public", "live", rc, repc, created)
        })
        .collect();

    let n = state.search.index_many(&docs).await;
    tracing::info!(indexed = n, "reindex complete");
    Ok(Json(ReindexResult { indexed: n }))
}
