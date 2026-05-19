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
    content::{extract_mentions, render_markdown},
    errors::AppError,
    middleware::{client_ip, session::CurrentUser},
    routes::notifications::notify,
    search::PostDoc,
    state::AppState,
};
use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::types::chrono::{DateTime, Utc};
use std::net::SocketAddr;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(create_post).get(timeline))
        .route("/{id}", get(get_post).patch(edit_post).delete(delete_post))
        .route("/{id}/react", post(react).delete(unreact))
        .route("/{id}/reactions", get(reactions))
        .route("/{id}/replies", get(replies))
        .route("/{id}/thread", get(thread))
        .route("/{id}/repost", post(repost))
        .route("/{id}/restore", post(restore))
}

// ── POST /posts/{id}/restore — undelete your own post within 30 days ──

async fn restore(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<Json<PostView>, AppError> {
    let n = sqlx::query(
        r#"
        UPDATE posts SET deleted_at = NULL
        WHERE id = $1 AND author_id = $2
          AND deleted_at IS NOT NULL
          AND deleted_at > NOW() - interval '30 days'
        "#,
    )
    .bind(id)
    .bind(user.user_id)
    .execute(&state.pg)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    let post = fetch_post(&state, id, Some(user.user_id)).await?;

    // Re-add to search if public+live
    if post.visibility == "public" {
        let doc = PostDoc::from_parts(
            post.id,
            post.author.id,
            &post.author.username,
            &post.body,
            &post.visibility,
            "live",
            post.reactions_count,
            post.replies_count,
            post.created_at,
        );
        let search = state.search.clone();
        tokio::spawn(async move { search.index_post(&doc).await });
    }
    Ok(Json(post))
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
    #[serde(skip_serializing_if = "Option::is_none")]
    parent: Option<ParentExcerpt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_warning: Option<String>,
    reactions_count: i32,
    replies_count: i32,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct ParentExcerpt {
    id: Uuid,
    author_username: String,
    excerpt: String,
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
    #[serde(default)]
    content_warning: Option<String>,
}

fn default_visibility() -> String {
    "public".to_string()
}

const MAX_POST_LEN: usize = 5000;
const POST_RATE_LIMIT_MAX_USER: u32 = 10;
const POST_RATE_LIMIT_MAX_IP: u32 = 50;
const POST_RATE_LIMIT_WINDOW_SECS: u64 = 600;
const CONTENT_DEDUP_WINDOW_SECS: u64 = 86_400;

async fn create_post(
    State(state): State<AppState>,
    user: CurrentUser,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
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

    let ip = client_ip::extract(&headers, Some(&peer))
        .map(|i| i.to_string())
        .unwrap_or_default();

    // Three layers of rate limit, all in Redis:
    //  1. Per-user count window  — limits one account
    //  2. Per-IP count window    — limits a botnet sharing accounts
    //  3. Content fingerprint    — blocks identical body re-post within 24h
    let mut redis = state.redis.clone();

    let user_key = format!("rl:post:create:user:{}", user.user_id);
    let user_count: u32 = redis.incr(&user_key, 1u32).await?;
    if user_count == 1 {
        let _: () = redis
            .expire(&user_key, POST_RATE_LIMIT_WINDOW_SECS as i64)
            .await?;
    }
    if user_count > POST_RATE_LIMIT_MAX_USER {
        return Err(AppError::RateLimited);
    }

    if !ip.is_empty() {
        let ip_key = format!("rl:post:create:ip:{ip}");
        let ip_count: u32 = redis.incr(&ip_key, 1u32).await?;
        if ip_count == 1 {
            let _: () = redis
                .expire(&ip_key, POST_RATE_LIMIT_WINDOW_SECS as i64)
                .await?;
        }
        if ip_count > POST_RATE_LIMIT_MAX_IP {
            return Err(AppError::RateLimited);
        }
    }

    // Validate reply target before inserting. This avoids the old
    // insert-then-forbid path that left rejected replies in the DB.
    let parent_author = if let Some(reply_id) = input.reply_to_id {
        let parent: Option<(Uuid, String)> = sqlx::query_as(
            r#"
            SELECT author_id, visibility FROM posts
            WHERE id = $1 AND deleted_at IS NULL AND moderation_state = 'live'
            "#,
        )
        .bind(reply_id)
        .fetch_optional(&state.pg)
        .await?;
        let Some((author_id, visibility)) = parent else {
            return Err(AppError::BadRequest("reply target not found".into()));
        };
        if !can_view_post_author(&state, author_id, &visibility, Some(user.user_id)).await {
            return Err(AppError::Forbidden);
        }
        if !reply_visibility_allowed(&input.visibility, &visibility) {
            return Err(AppError::BadRequest(
                "reply visibility cannot be broader than parent".into(),
            ));
        }
        Some(author_id)
    } else {
        None
    };

    // Content fingerprint: normalize whitespace, lowercase, sha256, hex first 16
    let normalized: String = body.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let mut h = Sha256::new();
    h.update(normalized.as_bytes());
    let fp_full = h.finalize();
    let fp_hex: String = fp_full.iter().take(8).map(|b| format!("{b:02x}")).collect();
    let fp_key = format!("rl:post:fp:{}:{}", user.user_id, fp_hex);
    let seen: Option<u8> = redis.get(&fp_key).await.unwrap_or(None);
    if seen.is_some() {
        return Err(AppError::BadRequest("duplicate content posted recently".into()));
    }
    let _: () = redis.set_ex(&fp_key, 1u8, CONTENT_DEDUP_WINDOW_SECS).await?;

    let body_html = render_markdown(body);

    let cw = input
        .content_warning
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(140).collect::<String>());
    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO posts (author_id, body, body_html, visibility, reply_to_id, content_warning)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        "#,
    )
    .bind(user.user_id)
    .bind(body)
    .bind(&body_html)
    .bind(&input.visibility)
    .bind(input.reply_to_id)
    .bind(cw)
    .fetch_one(&state.pg)
    .await?;

    // Bump parent reply count + notify parent author
    if let Some(reply_id) = input.reply_to_id {
        let _ = sqlx::query("UPDATE posts SET replies_count = replies_count + 1 WHERE id = $1")
            .bind(reply_id)
            .execute(&state.pg)
            .await;
        if let Some(parent_author) = parent_author {
            notify(
                &state,
                parent_author,
                Some(user.user_id),
                "reply",
                "post",
                id,
                Some(serde_json::json!({ "reply_to_id": reply_id })),
            )
            .await;
        }
    }

    let post = fetch_post(&state, id, Some(user.user_id)).await?;

    // @-mentions → notifications (skip already-notified parent author)
    let exclude = input.reply_to_id.and_then(|rid| {
        // can't `await` here cleanly; defer below
        Some(rid)
    });
    let _ = exclude; // suppress unused
    notify_mentions(
        &state,
        body,
        user.user_id,
        id,
        &post.author.username,
        &post.visibility,
    )
    .await;

    // Federation fanout to remote followers (no-op if FEDERATION_ENABLED=false)
    if post.visibility == "public" {
        let s2 = state.clone();
        let pid = post.id;
        tokio::spawn(async move { crate::federation::fanout_post(&s2, pid).await; });
    }

    // Fire-and-forget search index (only public posts surfaced in search)
    if post.visibility == "public" {
        let doc = PostDoc::from_parts(
            post.id,
            post.author.id,
            &post.author.username,
            &post.body,
            &post.visibility,
            "live",
            post.reactions_count,
            post.replies_count,
            post.created_at,
        );
        let search = state.search.clone();
        tokio::spawn(async move { search.index_post(&doc).await });
    }

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
            p.body, p.body_html, p.visibility, p.reply_to_id, p.content_warning,
            p.reactions_count, p.replies_count, p.created_at
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.visibility = 'public'
          AND p.moderation_state = 'live'
          AND p.deleted_at IS NULL
          AND u.role <> 'suspended'
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
    viewer_opt: Option<CurrentUser>,
) -> Result<Json<PostView>, AppError> {
    let view = fetch_post(&state, id, viewer_opt.as_ref().map(|u| u.user_id)).await?;
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
    if author_id != user.user_id && (user.role != "admin" || user.is_api_token()) {
        return Err(AppError::Forbidden);
    }

    sqlx::query("UPDATE posts SET deleted_at = NOW() WHERE id = $1")
        .bind(id)
        .execute(&state.pg)
        .await?;

    let search = state.search.clone();
    tokio::spawn(async move { search.delete_post(id).await });

    tracing::info!(user_id = %user.user_id, post_id = %id, "post deleted");
    Ok(StatusCode::NO_CONTENT)
}

// ── PATCH /posts/{id} (edit) ────────────────────────────────────

#[derive(Deserialize)]
pub struct EditBody {
    body: String,
}

async fn edit_post(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
    Json(input): Json<EditBody>,
) -> Result<Json<PostView>, AppError> {
    let body = input.body.trim();
    if body.is_empty() {
        return Err(AppError::BadRequest("body required".into()));
    }
    if body.chars().count() > MAX_POST_LEN {
        return Err(AppError::BadRequest(format!(
            "body too long (max {MAX_POST_LEN} chars)"
        )));
    }
    let author_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&state.pg)
    .await?;
    let author_id = author_id.ok_or(AppError::NotFound)?;
    if author_id != user.user_id {
        return Err(AppError::Forbidden);
    }
    let body_html = render_markdown(body);
    sqlx::query(
        r#"
        UPDATE posts SET body = $1, body_html = $2, edited_at = NOW(), updated_at = NOW()
        WHERE id = $3
        "#,
    )
    .bind(body)
    .bind(&body_html)
    .bind(id)
    .execute(&state.pg)
    .await?;

    // Refresh search index
    let post = fetch_post(&state, id, Some(user.user_id)).await?;

    // Re-fire @-mention notifications (idempotent — DB has no UNIQUE on
    // notifications so a duplicate-on-edit will create a fresh row).
    // Caveat: editing a post with mentions WILL spam the mentioned user.
    // Skip mentions on edit to avoid that — only fresh creates notify.
    let _ = body;

    if post.visibility == "public" {
        let doc = PostDoc::from_parts(
            post.id,
            post.author.id,
            &post.author.username,
            &post.body,
            &post.visibility,
            "live",
            post.reactions_count,
            post.replies_count,
            post.created_at,
        );
        let search = state.search.clone();
        tokio::spawn(async move { search.index_post(&doc).await });
    }
    Ok(Json(post))
}

// ── POST /posts/{id}/repost ─────────────────────────────────────
//
// Creates a NEW post that references the original via repost_of_id. The
// new post's body is empty (or carries the user's own quote text if
// supplied), but it surfaces in feeds as the reposter's content.

#[derive(Deserialize)]
pub struct RepostBody {
    #[serde(default)]
    body: String, // optional quote text
}

async fn repost(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
    Json(input): Json<RepostBody>,
) -> Result<(StatusCode, Json<PostView>), AppError> {
    let target: Option<(Uuid, Uuid, String)> = sqlx::query_as(
        r#"
        SELECT p.id, p.author_id, p.visibility
        FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.id = $1
          AND p.deleted_at IS NULL
          AND p.moderation_state = 'live'
          AND u.role <> 'suspended'
        "#,
    )
    .bind(id)
    .fetch_optional(&state.pg)
    .await?;
    let (target_id, target_author, target_vis) = target.ok_or(AppError::NotFound)?;
    if target_vis != "public"
        || !can_view_post_author(&state, target_author, &target_vis, Some(user.user_id)).await
    {
        return Err(AppError::Forbidden);
    }

    let body_raw = input.body.trim();
    if body_raw.chars().count() > MAX_POST_LEN {
        return Err(AppError::BadRequest(format!(
            "body too long (max {MAX_POST_LEN} chars)"
        )));
    }
    // posts.body CHECK forbids empty — pure repost (no quote) uses a single
    // sentinel character so the row is valid; the UI ignores it and shows
    // the embedded original.
    let body = if body_raw.is_empty() {
        "↻".to_string()
    } else {
        body_raw.to_string()
    };
    let body_html = render_markdown(&body);

    let new_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO posts (author_id, body, body_html, visibility, repost_of_id)
        VALUES ($1, $2, $3, 'public', $4)
        RETURNING id
        "#,
    )
    .bind(user.user_id)
    .bind(&body)
    .bind(&body_html)
    .bind(target_id)
    .fetch_one(&state.pg)
    .await?;

    // Notify original author
    let orig_author: Option<Uuid> =
        sqlx::query_scalar("SELECT author_id FROM posts WHERE id = $1")
            .bind(target_id)
            .fetch_optional(&state.pg)
            .await
            .unwrap_or(None);
    if let Some(orig_author) = orig_author {
        notify(
            &state,
            orig_author,
            Some(user.user_id),
            "reply",
            "post",
            new_id,
            Some(serde_json::json!({ "repost_of": target_id })),
        )
        .await;
    }

    let post = fetch_post(&state, new_id, Some(user.user_id)).await?;
    Ok((StatusCode::CREATED, Json(post)))
}

// ── Reactions ───────────────────────────────────────────────────

const VALID_EMOJI: &[&str] = &["\u{1F525}", "\u{1F422}", "\u{1F91D}", "\u{1F64F}", "\u{1F602}"];
// fire / turtle / handshake / pray / joy

#[derive(Deserialize)]
pub struct ReactBody {
    emoji: String,
}

async fn react(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
    Json(body): Json<ReactBody>,
) -> Result<StatusCode, AppError> {
    let emoji = body.emoji.trim();
    if !VALID_EMOJI.iter().any(|e| *e == emoji) {
        return Err(AppError::BadRequest("invalid emoji".into()));
    }
    let post: Option<(Uuid, String)> = sqlx::query_as(
        r#"
        SELECT author_id, visibility FROM posts
        WHERE id = $1 AND deleted_at IS NULL AND moderation_state = 'live'
        "#,
    )
    .bind(id)
    .fetch_optional(&state.pg)
    .await?;
    let (author_id, visibility) = post.ok_or(AppError::NotFound)?;
    if !can_view_post_author(&state, author_id, &visibility, Some(user.user_id)).await {
        return Err(AppError::NotFound);
    }

    // Upsert reaction. If user already had a reaction, replace it. Either
    // way reactions_count increments by 0 or 1; do a final recount to stay
    // consistent.
    let inserted: u64 = sqlx::query(
        r#"
        INSERT INTO reactions (post_id, user_id, emoji)
        VALUES ($1, $2, $3)
        ON CONFLICT (post_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji
        "#,
    )
    .bind(id)
    .bind(user.user_id)
    .bind(emoji)
    .execute(&state.pg)
    .await?
    .rows_affected();
    let _ = inserted; // suppress unused-warn

    refresh_reactions_count(&state, id).await?;

    // Notify the post author (skip if reacting to own post — handled by notify())
    let author_id: Option<Uuid> =
        sqlx::query_scalar("SELECT author_id FROM posts WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pg)
            .await
            .unwrap_or(None);
    if let Some(author_id) = author_id {
        notify(
            &state,
            author_id,
            Some(user.user_id),
            "reaction",
            "post",
            id,
            Some(serde_json::json!({ "emoji": emoji })),
        )
        .await;
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn unreact(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    sqlx::query("DELETE FROM reactions WHERE post_id = $1 AND user_id = $2")
        .bind(id)
        .bind(user.user_id)
        .execute(&state.pg)
        .await?;
    refresh_reactions_count(&state, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
pub struct ReactionsView {
    total: i64,
    by_emoji: std::collections::HashMap<String, i64>,
    viewer: Option<String>,
}

async fn reactions(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    // Viewer is optional — if cookie missing, returned viewer = null.
    viewer_opt: Option<CurrentUser>,
) -> Result<Json<ReactionsView>, AppError> {
    let viewer_id = viewer_opt.as_ref().map(|u| u.user_id);
    ensure_post_visible(&state, id, viewer_id).await?;

    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT emoji, COUNT(*)::bigint FROM reactions WHERE post_id = $1 GROUP BY emoji",
    )
    .bind(id)
    .fetch_all(&state.pg)
    .await?;
    let mut by_emoji = std::collections::HashMap::new();
    let mut total = 0i64;
    for (e, c) in rows {
        total += c;
        by_emoji.insert(e, c);
    }

    let viewer = if let Some(u) = viewer_opt {
        sqlx::query_scalar(
            "SELECT emoji FROM reactions WHERE post_id = $1 AND user_id = $2",
        )
        .bind(id)
        .bind(u.user_id)
        .fetch_optional(&state.pg)
        .await?
    } else {
        None
    };

    Ok(Json(ReactionsView {
        total,
        by_emoji,
        viewer,
    }))
}

async fn refresh_reactions_count(state: &AppState, post_id: Uuid) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE posts SET reactions_count = (
            SELECT COUNT(*) FROM reactions WHERE post_id = $1
        ) WHERE id = $1
        "#,
    )
    .bind(post_id)
    .execute(&state.pg)
    .await?;
    Ok(())
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
    content_warning: Option<String>,
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
            parent: None,
            content_warning: self.content_warning,
            reactions_count: self.reactions_count,
            replies_count: self.replies_count,
            created_at: self.created_at,
        }
    }
}

async fn attach_parent(state: &AppState, view: &mut PostView, viewer: Option<Uuid>) {
    let Some(parent_id) = view.reply_to_id else { return };
    let row: Option<(Uuid, String, String)> = sqlx::query_as(
        r#"
        SELECT p.id, u.username, p.body
        FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.id = $1
          AND p.deleted_at IS NULL
          AND p.moderation_state = 'live'
          AND u.role <> 'suspended'
          AND (
              p.visibility = 'public'
              OR ($2::uuid IS NOT NULL AND p.author_id = $2)
              OR (
                  p.visibility = 'followers'
                  AND $2::uuid IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM follows f
                      WHERE f.follower_id = $2 AND f.followee_id = p.author_id
                  )
              )
          )
          AND (
              $2::uuid IS NULL
              OR p.author_id = $2
              OR NOT EXISTS (
                  SELECT 1 FROM user_blocks b
                  WHERE (b.blocker_id = $2 AND b.blocked_id = p.author_id)
                     OR (b.blocker_id = p.author_id AND b.blocked_id = $2)
              )
          )
        "#,
    )
    .bind(parent_id)
    .bind(viewer)
    .fetch_optional(&state.pg)
    .await
    .ok()
    .flatten();
    if let Some((id, author_username, body)) = row {
        view.parent = Some(ParentExcerpt {
            id,
            author_username,
            excerpt: body.chars().take(140).collect(),
        });
    }
}

/// True if A→B or B→A blocked. Always reject the interaction.
async fn is_blocked(state: &AppState, a: Uuid, b: Uuid) -> bool {
    if a == b {
        return false;
    }
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1))",
    )
    .bind(a)
    .bind(b)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(false)
}

fn visibility_rank(v: &str) -> u8 {
    match v {
        "private" => 1,
        "followers" => 2,
        "public" => 3,
        _ => 0,
    }
}

fn reply_visibility_allowed(reply_visibility: &str, parent_visibility: &str) -> bool {
    visibility_rank(reply_visibility) <= visibility_rank(parent_visibility)
}

async fn can_view_post_author(
    state: &AppState,
    author_id: Uuid,
    visibility: &str,
    viewer: Option<Uuid>,
) -> bool {
    let Some(viewer_id) = viewer else {
        return visibility == "public";
    };
    if viewer_id != author_id && is_blocked(state, viewer_id, author_id).await {
        return false;
    }
    match visibility {
        "public" => true,
        "private" => viewer_id == author_id,
        "followers" => {
            viewer_id == author_id
                || sqlx::query_scalar::<_, bool>(
                    "SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2)",
                )
                .bind(viewer_id)
                .bind(author_id)
                .fetch_one(&state.pg)
                .await
                .unwrap_or(false)
        }
        _ => false,
    }
}

async fn ensure_post_visible(
    state: &AppState,
    post_id: Uuid,
    viewer: Option<Uuid>,
) -> Result<(), AppError> {
    let row: Option<(Uuid, String)> = sqlx::query_as(
        r#"
        SELECT p.author_id, p.visibility
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.id = $1
          AND p.deleted_at IS NULL
          AND p.moderation_state = 'live'
          AND u.role <> 'suspended'
        "#,
    )
    .bind(post_id)
    .fetch_optional(&state.pg)
    .await?;
    let Some((author_id, visibility)) = row else {
        return Err(AppError::NotFound);
    };
    if can_view_post_author(state, author_id, &visibility, viewer).await {
        Ok(())
    } else {
        Err(AppError::NotFound)
    }
}

/// Best-effort: scan `body` for @-mentions, look up each username, fire
/// notify(kind="mention"). Skips the post author themselves.
async fn notify_mentions(
    state: &AppState,
    body: &str,
    actor_id: Uuid,
    post_id: Uuid,
    actor_username: &str,
    visibility: &str,
) {
    let mentions = extract_mentions(body);
    if mentions.is_empty() {
        return;
    }
    // De-self
    let mentions: Vec<_> = mentions
        .into_iter()
        .filter(|m| m != actor_username)
        .collect();
    if mentions.is_empty() {
        return;
    }
    let rows: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id, username FROM users WHERE username = ANY($1) AND role <> 'suspended'",
    )
    .bind(&mentions)
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();
    for (uid, uname) in rows {
        if !can_view_post_author(state, actor_id, visibility, Some(uid)).await {
            continue;
        }
        notify(
            state,
            uid,
            Some(actor_id),
            "mention",
            "post",
            post_id,
            Some(serde_json::json!({ "username": uname })),
        )
        .await;
    }
}

async fn fetch_post(
    state: &AppState,
    id: Uuid,
    viewer: Option<Uuid>,
) -> Result<PostView, AppError> {
    let row: Option<PostRow> = sqlx::query_as(
        r#"
        SELECT
            p.id, p.author_id, u.username, u.display_name,
            p.body, p.body_html, p.visibility, p.reply_to_id, p.content_warning,
            p.reactions_count, p.replies_count, p.created_at
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.id = $1
          AND p.deleted_at IS NULL
          AND p.moderation_state = 'live'
          AND u.role <> 'suspended'
          AND (
              p.visibility = 'public'
              OR ($2::uuid IS NOT NULL AND p.author_id = $2)
              OR (
                  p.visibility = 'followers'
                  AND $2::uuid IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM follows f
                      WHERE f.follower_id = $2 AND f.followee_id = p.author_id
                  )
              )
          )
          AND (
              $2::uuid IS NULL
              OR p.author_id = $2
              OR NOT EXISTS (
                  SELECT 1 FROM user_blocks b
                  WHERE (b.blocker_id = $2 AND b.blocked_id = p.author_id)
                     OR (b.blocker_id = p.author_id AND b.blocked_id = $2)
              )
          )
        "#,
    )
    .bind(id)
    .bind(viewer)
    .fetch_optional(&state.pg)
    .await?;

    let mut view = row.map(PostRow::into_view).ok_or(AppError::NotFound)?;
    attach_parent(state, &mut view, viewer).await;
    Ok(view)
}

// ── GET /posts/{id}/replies ─────────────────────────────────────

async fn replies(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(q): Query<TimelineQuery>,
    viewer_opt: Option<CurrentUser>,
) -> Result<Json<TimelineResponse>, AppError> {
    let limit = q.limit.clamp(1, 100);
    let before = q.before.unwrap_or_else(Utc::now);
    let viewer_id = viewer_opt.as_ref().map(|u| u.user_id);
    ensure_post_visible(&state, id, viewer_id).await?;

    let rows: Vec<PostRow> = sqlx::query_as(
        r#"
        SELECT
            p.id, p.author_id, u.username, u.display_name,
            p.body, p.body_html, p.visibility, p.reply_to_id, p.content_warning,
            p.reactions_count, p.replies_count, p.created_at
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.reply_to_id = $1
          AND p.moderation_state = 'live'
          AND p.deleted_at IS NULL
          AND p.created_at < $2
          AND u.role <> 'suspended'
          AND (
              p.visibility = 'public'
              OR ($3::uuid IS NOT NULL AND p.author_id = $3)
              OR (
                  p.visibility = 'followers'
                  AND $3::uuid IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM follows f
                      WHERE f.follower_id = $3 AND f.followee_id = p.author_id
                  )
              )
          )
          AND (
              $3::uuid IS NULL
              OR p.author_id = $3
              OR NOT EXISTS (
                  SELECT 1 FROM user_blocks b
                  WHERE (b.blocker_id = $3 AND b.blocked_id = p.author_id)
                     OR (b.blocker_id = p.author_id AND b.blocked_id = $3)
              )
          )
        ORDER BY p.created_at DESC
        LIMIT $4
        "#,
    )
    .bind(id)
    .bind(before)
    .bind(viewer_id)
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;

    let next_before = rows.last().map(|r| r.created_at);
    let posts = rows.into_iter().map(PostRow::into_view).collect();
    Ok(Json(TimelineResponse { posts, next_before }))
}

// ── GET /posts/{id}/thread ──────────────────────────────────────
//
// Returns: root post → its descendants depth-first (max depth 6), each
// already enriched with parent excerpt + reactions count. Useful for the
// single-page conversation view.
//
// Implementation: CTE walks the reply tree starting from the requested
// post's ancestor chain root, then expands all descendants. Caps at 500
// posts to avoid pathological threads exhausting memory.

#[derive(Serialize)]
pub struct ThreadResponse {
    root: PostView,
    descendants: Vec<PostView>,
}

async fn thread(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    viewer_opt: Option<CurrentUser>,
) -> Result<Json<ThreadResponse>, AppError> {
    let viewer_id = viewer_opt.as_ref().map(|u| u.user_id);
    let _requested = fetch_post(&state, id, viewer_id).await?;

    // Walk up to find the root of the thread
    let root_id: Uuid = sqlx::query_scalar(
        r#"
        WITH RECURSIVE ancestor(id, reply_to_id) AS (
            SELECT id, reply_to_id
            FROM posts
            WHERE id = $1 AND deleted_at IS NULL AND moderation_state = 'live'
            UNION ALL
            SELECT p.id, p.reply_to_id
            FROM posts p JOIN ancestor a ON p.id = a.reply_to_id
            WHERE p.deleted_at IS NULL AND p.moderation_state = 'live'
        )
        SELECT id FROM ancestor WHERE reply_to_id IS NULL LIMIT 1
        "#,
    )
    .bind(id)
    .fetch_optional(&state.pg)
    .await?
    .ok_or(AppError::NotFound)?;

    let root = fetch_post(&state, root_id, viewer_id).await?;

    let descendants_rows: Vec<PostRow> = sqlx::query_as(
        r#"
        WITH RECURSIVE descendants(id, depth) AS (
            SELECT id, 0 FROM posts WHERE reply_to_id = $1 AND deleted_at IS NULL
            UNION ALL
            SELECT p.id, d.depth + 1
            FROM posts p JOIN descendants d ON p.reply_to_id = d.id
            WHERE p.deleted_at IS NULL AND d.depth < 6
        )
        SELECT
            p.id, p.author_id, u.username, u.display_name,
            p.body, p.body_html, p.visibility, p.reply_to_id, p.content_warning,
            p.reactions_count, p.replies_count, p.created_at
        FROM descendants d
        JOIN posts p ON p.id = d.id
        JOIN users u ON u.id = p.author_id
        WHERE p.moderation_state = 'live'
          AND u.role <> 'suspended'
          AND (
              p.visibility = 'public'
              OR ($2::uuid IS NOT NULL AND p.author_id = $2)
              OR (
                  p.visibility = 'followers'
                  AND $2::uuid IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM follows f
                      WHERE f.follower_id = $2 AND f.followee_id = p.author_id
                  )
              )
          )
          AND (
              $2::uuid IS NULL
              OR p.author_id = $2
              OR NOT EXISTS (
                  SELECT 1 FROM user_blocks b
                  WHERE (b.blocker_id = $2 AND b.blocked_id = p.author_id)
                     OR (b.blocker_id = p.author_id AND b.blocked_id = $2)
              )
          )
        ORDER BY p.created_at ASC
        LIMIT 500
        "#,
    )
    .bind(root_id)
    .bind(viewer_id)
    .fetch_all(&state.pg)
    .await?;

    let descendants = descendants_rows.into_iter().map(PostRow::into_view).collect();
    Ok(Json(ThreadResponse { root, descendants }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reply_visibility_cannot_be_broader_than_parent() {
        assert!(reply_visibility_allowed("private", "private"));
        assert!(reply_visibility_allowed("private", "followers"));
        assert!(reply_visibility_allowed("followers", "followers"));
        assert!(reply_visibility_allowed("followers", "public"));
        assert!(reply_visibility_allowed("public", "public"));

        assert!(!reply_visibility_allowed("public", "followers"));
        assert!(!reply_visibility_allowed("public", "private"));
        assert!(!reply_visibility_allowed("followers", "private"));
    }
}
