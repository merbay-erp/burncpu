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
    middleware::{auth_extractor::AdminUser, session::CurrentUser},
    search::PostDoc,
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::types::chrono::{DateTime, Utc};
use std::collections::HashMap;
use uuid::Uuid;

type ReindexRow = (Uuid, Uuid, String, String, DateTime<Utc>, i32, i32);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(search))
        .route("/reindex", post(reindex))
}

pub fn hashtags_router() -> Router<AppState> {
    Router::new().route("/{tag}", get(by_hashtag)).route(
        "/{tag}/follow",
        get(follow_state).post(follow_tag).delete(unfollow_tag),
    )
}

// ─── Hashtag follow ─────────────────────────────────────────────
//
// Follow a topic (not a person): public posts carrying a followed tag surface
// in the personal feed (see routes::feed). Tags are normalized to lowercase
// `[a-z0-9_]{2,32}` — which also keeps them safe to interpolate into the feed's
// boundary regex.

fn normalize_tag(raw: &str) -> Result<String, AppError> {
    let t = raw.trim_start_matches('#').to_lowercase();
    if t.len() < 2 || t.len() > 32 || !t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(AppError::BadRequest("invalid hashtag".into()));
    }
    Ok(t)
}

async fn follow_tag(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(tag): Path<String>,
) -> Result<StatusCode, AppError> {
    let tag = normalize_tag(&tag)?;
    sqlx::query(
        "INSERT INTO hashtag_follows (user_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(user.user_id)
    .bind(&tag)
    .execute(&state.pg)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn unfollow_tag(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(tag): Path<String>,
) -> Result<StatusCode, AppError> {
    let tag = normalize_tag(&tag)?;
    sqlx::query("DELETE FROM hashtag_follows WHERE user_id = $1 AND tag = $2")
        .bind(user.user_id)
        .bind(&tag)
        .execute(&state.pg)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
pub struct FollowState {
    following: bool,
}

async fn follow_state(
    State(state): State<AppState>,
    user: Option<CurrentUser>,
    Path(tag): Path<String>,
) -> Result<Json<FollowState>, AppError> {
    let tag = normalize_tag(&tag)?;
    let following = match user {
        Some(u) => {
            sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM hashtag_follows WHERE user_id = $1 AND tag = $2)",
            )
            .bind(u.user_id)
            .bind(&tag)
            .fetch_one(&state.pg)
            .await?
        }
        None => false,
    };
    Ok(Json(FollowState { following }))
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
    let mut result = state
        .search
        .search_public(q.q.trim(), q.tag.as_deref(), limit)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    enrich_avatars(&state, &mut result).await;
    Ok(Json(result))
}

/// Inject each hit author's *current* avatar_url from Postgres as
/// `author_avatar_url`. Sourced live (not from the index) so an avatar change
/// shows up in search immediately without a re-index.
async fn enrich_avatars(state: &AppState, result: &mut Value) {
    let Some(hits) = result.get_mut("hits").and_then(|h| h.as_array_mut()) else {
        return;
    };
    let ids: Vec<Uuid> = hits
        .iter()
        .filter_map(|h| h.get("author_id").and_then(Value::as_str))
        .filter_map(|s| Uuid::parse_str(s).ok())
        .collect();
    if ids.is_empty() {
        return;
    }
    let rows: Vec<(Uuid, String, Option<String>)> =
        sqlx::query_as("SELECT id, display_name, avatar_url FROM users WHERE id = ANY($1)")
            .bind(&ids)
            .fetch_all(&state.pg)
            .await
            .unwrap_or_default();
    let map: HashMap<Uuid, (String, Option<String>)> = rows
        .into_iter()
        .map(|(id, name, avatar)| (id, (name, avatar.filter(|s| !s.is_empty()))))
        .collect();
    for h in hits.iter_mut() {
        let entry = h
            .get("author_id")
            .and_then(Value::as_str)
            .and_then(|s| Uuid::parse_str(s).ok())
            .and_then(|id| map.get(&id).cloned());
        if let (Some((name, avatar)), Some(obj)) = (entry, h.as_object_mut()) {
            obj.insert("author_display_name".to_string(), Value::String(name));
            if let Some(avatar) = avatar {
                obj.insert("author_avatar_url".to_string(), Value::String(avatar));
            }
        }
    }
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
    let mut result = state
        .search
        .search_public("", Some(&tag), limit)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    enrich_avatars(&state, &mut result).await;
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
    const BATCH: i64 = 1_000;
    let mut cursor: Option<(DateTime<Utc>, Uuid)> = None;
    let mut indexed = 0usize;

    loop {
        let before_created = cursor.as_ref().map(|(created, _)| created.to_owned());
        let before_id = cursor.as_ref().map(|(_, id)| *id);
        let rows: Vec<ReindexRow> = sqlx::query_as(
            r#"
            SELECT p.id, p.author_id, u.username, p.body, p.created_at,
                   p.reactions_count, p.replies_count
            FROM posts p JOIN users u ON u.id = p.author_id
            WHERE p.deleted_at IS NULL
              AND p.moderation_state = 'live'
              AND p.visibility = 'public'
              AND u.role <> 'suspended'
              AND (
                  $1::timestamptz IS NULL
                  OR (p.created_at, p.id) < ($1::timestamptz, $2::uuid)
              )
            ORDER BY p.created_at DESC, p.id DESC
            LIMIT $3
            "#,
        )
        .bind(before_created)
        .bind(before_id)
        .bind(BATCH)
        .fetch_all(&state.pg)
        .await?;

        if rows.is_empty() {
            break;
        }
        let batch_len = rows.len();
        cursor = rows.last().map(|row| (row.4.to_owned(), row.0));
        let docs: Vec<PostDoc> = rows
            .into_iter()
            .map(|(id, author_id, username, body, created, rc, repc)| {
                PostDoc::from_parts(
                    id, author_id, &username, &body, "public", "live", rc, repc, created,
                )
            })
            .collect();
        let accepted = state.search.index_many(&docs).await;
        if accepted != batch_len {
            return Err(AppError::Internal(anyhow::anyhow!(
                "meilisearch rejected reindex batch"
            )));
        }
        indexed += accepted;
        tracing::info!(indexed, batch = accepted, "reindex batch accepted");

        if batch_len < BATCH as usize {
            break;
        }
    }

    tracing::info!(indexed, "reindex complete");
    Ok(Json(ReindexResult { indexed }))
}
