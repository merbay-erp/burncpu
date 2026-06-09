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
    routes::link_preview::{self, LinkPreview},
    routes::notifications::notify,
    search::PostDoc,
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
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
        .route("/{id}/history", get(post_history))
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

    // Undo the decrement that delete_post applied to the parent's reply count.
    if let Some(parent) = post.reply_to_id {
        let _ = sqlx::query("UPDATE posts SET replies_count = replies_count + 1 WHERE id = $1")
            .bind(parent)
            .execute(&state.pg)
            .await;
    }

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
    #[serde(skip_serializing_if = "Option::is_none")]
    edited_at: Option<DateTime<Utc>>,
    // 19 May 2026 — Viewer-spesifik state. Frontend Post.tsx sayfa refresh
    // sonrasi react/bookmark butonlarinin DOGRU state'te yuklenebilmesi icin.
    // Onceden setReacted(false) ile basliyordu → refresh sonrasi 🐢 ikonu
    // hep bos goruluyordu (kullanici "react atmis miydim?" diye karistiriyordu).
    // None = anonim viewer; Some(false/true) = giris yapmis.
    #[serde(skip_serializing_if = "Option::is_none")]
    viewer_reacted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    viewer_bookmarked: Option<bool>,
    created_at: DateTime<Utc>,
    // Already-cached link unfurl for this post's first URL, embedded by the
    // timeline so the above-the-fold card (the LCP image) renders without the
    // client's extra /link-preview round-trip. Present only on a cache hit;
    // otherwise omitted and the client fetches it lazily as before.
    #[serde(skip_serializing_if = "Option::is_none")]
    link_preview: Option<LinkPreview>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar_url: Option<String>,
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

// Trust gate: a brand-new account's top-level public posts go to the moderation
// queue (moderation_state='quarantine') instead of the public timeline, until
// the account ages past QUARANTINE_MIN_AGE_HOURS or earns QUARANTINE_MIN_LIVE_POSTS
// approved posts. Admins/mods, replies, and non-public posts are never gated.
// The admin queue already exists: GET /admin/posts?state=quarantine + PATCH
// /admin/posts/{id} (approve → live / reject → removed). Tunable consts.
const QUARANTINE_MIN_AGE_HOURS: i64 = 24;
const QUARANTINE_MIN_LIVE_POSTS: i64 = 2;

// Multi-layered, model-agnostic spam score for a top-level post. Each signal is
// an independent layer that adds points; a future ML/heuristic layer slots in the
// same way. The post is quarantined when the total reaches `config.spam_threshold`
// — landing in the existing admin review queue rather than the public timeline.
// Returns (points, reasons); reasons are logged on quarantine for tuning.
async fn spam_score(state: &AppState, user: &CurrentUser, body: &str) -> (i32, Vec<String>) {
    if matches!(user.role.as_str(), "admin" | "mod") {
        return (0, Vec::new());
    }
    let mut pts = 0i32;
    let mut why: Vec<String> = Vec::new();

    // Layer 1 — account trust (age / approved posts / followers). Establishing
    // any of these earns trust and silences the new-account signal.
    let row: Option<(bool, i64, i64)> = sqlx::query_as(
        r#"
        SELECT
            (u.created_at < NOW() - ($2 || ' hours')::interval) AS aged,
            (SELECT COUNT(*) FROM posts p
                WHERE p.author_id = u.id AND p.moderation_state = 'live' AND p.deleted_at IS NULL) AS live_posts,
            (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers
        FROM users u WHERE u.id = $1
        "#,
    )
    .bind(user.user_id)
    .bind(QUARANTINE_MIN_AGE_HOURS.to_string())
    .fetch_optional(&state.pg)
    .await
    .ok()
    .flatten();
    // Fail OPEN on a glitch — treat as trusted rather than hide a legit post.
    let (aged, live_posts, followers) = row.unwrap_or((true, 99, 99));
    let trusted = aged || live_posts >= QUARANTINE_MIN_LIVE_POSTS || followers >= 5;
    if !trusted {
        pts += 3;
        why.push("new/untrusted account".into());
    }

    // Layer 2 — link density (the classic spam tell, weighted up for new accounts).
    let links = body.matches("http://").count() + body.matches("https://").count();
    if links >= 4 {
        pts += 3;
        why.push(format!("{links} links"));
    } else if links >= 2 {
        pts += 2;
        why.push(format!("{links} links"));
    } else if links == 1 && !trusted {
        pts += 1;
        why.push("link from new account".into());
    }

    // Layer 3 — mention flooding.
    let mentions = body.matches('@').count();
    if mentions >= 6 {
        pts += 2;
        why.push(format!("{mentions} mentions"));
    }

    // Layer 4 — shouting (mostly upper-case over a non-trivial length).
    let letters = body.chars().filter(|c| c.is_alphabetic()).count();
    let uppers = body.chars().filter(|c| c.is_uppercase()).count();
    if letters >= 24 && uppers * 100 / letters.max(1) >= 70 {
        pts += 1;
        why.push("shouting".into());
    }

    // Layer 5 — configurable denylist (SPAM_DENYLIST). Strong signal.
    let lower = body.to_lowercase();
    if let Some(term) = state
        .config
        .spam_denylist
        .iter()
        .find(|t| lower.contains(t.as_str()))
    {
        pts += 4;
        why.push(format!("denylist: {term}"));
    }

    (pts, why)
}

#[derive(Serialize)]
struct CreateResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    post: Option<PostView>,
    quarantined: bool,
}

/// Replace this post's rows in `post_hashtags` from `body`.
///
/// Single source of truth for hashtag extraction: the SAME regex backs the
/// migration backfill, so the indexed table and the feed's old inline
/// `(?<![[:alnum:]_])#…` lookbehind agree exactly. Tags are lowercased; the
/// leading-boundary group makes `#a#b` yield only `a`. Best-effort — a failure
/// here only costs this post a spot in followers' topic feeds, never the post
/// itself — so callers don't propagate the error.
async fn sync_hashtags(pg: &sqlx::PgPool, post_id: Uuid, body: &str) {
    // Replace semantics so an edit that drops a tag also drops its index row.
    if let Err(e) = sqlx::query("DELETE FROM post_hashtags WHERE post_id = $1")
        .bind(post_id)
        .execute(pg)
        .await
    {
        tracing::warn!(?e, %post_id, "post_hashtags clear failed");
        return;
    }
    if let Err(e) = sqlx::query(
        r#"
        INSERT INTO post_hashtags (post_id, tag)
        SELECT $1, m[2]
        FROM regexp_matches(lower($2), '(^|[^a-z0-9_])#([a-z0-9_]+)', 'g') AS m
        ON CONFLICT (post_id, tag) DO NOTHING
        "#,
    )
    .bind(post_id)
    .bind(body)
    .execute(pg)
    .await
    {
        tracing::warn!(?e, %post_id, "post_hashtags index failed");
    }
}

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
    if !matches!(
        input.visibility.as_str(),
        "public" | "followers" | "private"
    ) {
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
    let normalized: String = body
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let mut h = Sha256::new();
    h.update(normalized.as_bytes());
    let fp_full = h.finalize();
    let fp_hex: String = fp_full.iter().take(8).map(|b| format!("{b:02x}")).collect();
    let fp_key = format!("rl:post:fp:{}:{}", user.user_id, fp_hex);
    let seen: Option<u8> = redis.get(&fp_key).await.unwrap_or(None);
    if seen.is_some() {
        return Err(AppError::BadRequest(
            "duplicate content posted recently".into(),
        ));
    }
    let _: () = redis
        .set_ex(&fp_key, 1u8, CONTENT_DEDUP_WINDOW_SECS)
        .await?;

    let body_html = render_markdown(body);

    let cw = input
        .content_warning
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(140).collect::<String>());

    // Score the post; quarantine top-level public posts that cross the threshold.
    let (spam_pts, spam_reasons) = spam_score(&state, &user, body).await;
    let quarantine = input.reply_to_id.is_none()
        && input.visibility == "public"
        && spam_pts >= state.config.spam_threshold;
    let moderation_state = if quarantine { "quarantine" } else { "live" };

    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO posts (author_id, body, body_html, visibility, reply_to_id, content_warning, moderation_state)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        "#,
    )
    .bind(user.user_id)
    .bind(body)
    .bind(&body_html)
    .bind(&input.visibility)
    .bind(input.reply_to_id)
    .bind(cw)
    .bind(moderation_state)
    .fetch_one(&state.pg)
    .await?;

    // Index #hashtags for the followed-topics feed branch. Done for quarantined
    // posts too (harmless — the feed still filters moderation_state='live', so
    // they stay hidden until approved, at which point the index is already there).
    sync_hashtags(&state.pg, id, body).await;

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

    // Quarantined posts are invisible (no fetch, fanout, index, mention pings,
    // or timeline pill) until an admin approves them — the author just learns
    // it's pending review.
    if quarantine {
        tracing::info!(user_id = %user.user_id, post_id = %id, score = spam_pts, reasons = ?spam_reasons, "post quarantined (spam score)");
        return Ok((
            StatusCode::ACCEPTED,
            Json(CreateResponse {
                post: None,
                quarantined: true,
            }),
        ));
    }

    let post = fetch_post(&state, id, Some(user.user_id)).await?;

    // @-mentions → notifications.
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
        tokio::spawn(async move {
            crate::federation::fanout_post(&s2, pid).await;
        });
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

    // Real-time "new signal" firehose → drives the global timeline's live
    // "N new posts" pill. Only top-level public posts; the SSE stream fans
    // this out to every connected client except the author (who already sees
    // their own post prepended optimistically).
    if post.visibility == "public" && input.reply_to_id.is_none() {
        let _ = state.notif_tx.send(crate::state::NotificationEvent {
            user_id: post.author.id,
            kind: "new_post".into(),
            actor_id: Some(post.author.id),
            actor_username: Some(post.author.username.clone()),
            target_kind: "post".into(),
            target_id: post.id,
            created_at: post.created_at.to_rfc3339(),
        });
    }

    tracing::info!(user_id = %user.user_id, post_id = %id, "post created");
    Ok((
        StatusCode::CREATED,
        Json(CreateResponse {
            post: Some(post),
            quarantined: false,
        }),
    ))
}

// ── GET /posts (timeline) ───────────────────────────────────────

#[derive(Deserialize)]
pub struct TimelineQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    before: Option<DateTime<Utc>>,
    // Composite keyset cursor tie-breaker: when several posts share the exact
    // same `created_at`, paginating on the timestamp alone silently skips the
    // ones past the page boundary. The client echoes back the last row's id so
    // we can compare on `(created_at, id)`.
    before_id: Option<Uuid>,
}

fn default_limit() -> i64 {
    50
}

async fn timeline(
    State(state): State<AppState>,
    viewer_opt: Option<CurrentUser>,
    Query(q): Query<TimelineQuery>,
) -> Result<impl IntoResponse, AppError> {
    let limit = q.limit.clamp(1, 100);
    let before = q.before.unwrap_or_else(Utc::now);
    let viewer_id = viewer_opt.as_ref().map(|u| u.user_id);
    let before_id = q.before_id.unwrap_or(Uuid::nil());

    let compute = || async {
        let rows: Vec<PostRow> = sqlx::query_as(
            r#"
        SELECT
            p.id, p.author_id, u.username, u.display_name, u.avatar_url,
            p.body, p.body_html, p.visibility, p.reply_to_id, p.content_warning,
            p.reactions_count, p.replies_count, p.created_at, p.edited_at
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.visibility = 'public'
          AND p.moderation_state = 'live'
          AND p.deleted_at IS NULL
          AND p.reply_to_id IS NULL
          AND u.role <> 'suspended'
          AND ((p.created_at < $1) OR (p.created_at = $1 AND p.id < $4))
          AND (
              $3::uuid IS NULL
              OR p.author_id = $3
              OR NOT EXISTS (
                  SELECT 1 FROM user_blocks b
                  WHERE (b.blocker_id = $3 AND b.blocked_id = p.author_id)
                     OR (b.blocker_id = p.author_id AND b.blocked_id = $3)
              )
          )
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $2
        "#,
        )
        .bind(before)
        .bind(limit)
        .bind(viewer_id)
        .bind(before_id)
        .fetch_all(&state.pg)
        .await?;

        let next = rows.last().map(|r| (r.created_at, r.id));
        let mut posts: Vec<PostView> = rows.into_iter().map(PostRow::into_view).collect();
        enrich_cached_previews(&state, &mut posts).await;
        overlay_viewer_state(&state, &mut posts, viewer_id).await;
        let resp = TimelineResponse {
            posts,
            next_before: next.map(|(t, _)| t),
            next_before_id: next.map(|(_, id)| id),
        };
        serde_json::to_string(&resp).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))
    };

    // The anonymous public timeline page 1 is identical for every viewer, so it's
    // computed once and shared from Redis for a few seconds (stampede-guarded).
    // Logged-in (viewer-specific reaction/bookmark flags) or paginated requests
    // bypass the cache and compute directly.
    let json = if viewer_id.is_none() && q.before.is_none() {
        crate::cache::read_through_json(
            &mut state.redis.clone(),
            &format!("tl:pub:l{limit}"),
            20,
            compute,
        )
        .await?
    } else {
        compute().await?
    };

    Ok((
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        json,
    ))
}

#[derive(Serialize)]
pub struct TimelineResponse {
    posts: Vec<PostView>,
    next_before: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_before_id: Option<Uuid>,
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

// ── GET /posts/:id/history — prior versions of an edited post ────

#[derive(Serialize, sqlx::FromRow)]
struct PostEdit {
    body: String,
    body_html: String,
    edited_at: DateTime<Utc>,
}

async fn post_history(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    viewer_opt: Option<CurrentUser>,
) -> Result<Json<Vec<PostEdit>>, AppError> {
    // Visibility gate: fetch_post returns NotFound if the viewer can't see the
    // post, so its history is exactly as visible as the post itself.
    fetch_post(&state, id, viewer_opt.as_ref().map(|u| u.user_id)).await?;
    let edits = sqlx::query_as::<_, PostEdit>(
        "SELECT body, body_html, edited_at FROM post_edits
         WHERE post_id = $1 ORDER BY edited_at DESC, id DESC",
    )
    .bind(id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(edits))
}

// ── DELETE /posts/:id ───────────────────────────────────────────

async fn delete_post(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let row: Option<(Uuid, Option<Uuid>)> = sqlx::query_as(
        "SELECT author_id, reply_to_id FROM posts WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&state.pg)
    .await?;

    let (author_id, reply_to_id) = row.ok_or(AppError::NotFound)?;
    // Author, or an admin acting through a browser session (never an API
    // token — those must not wield admin moderation power).
    let is_admin_session = user.role == "admin" && !user.is_api_token();
    if author_id != user.user_id && !is_admin_session {
        return Err(AppError::Forbidden);
    }

    let affected =
        sqlx::query("UPDATE posts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL")
            .bind(id)
            .execute(&state.pg)
            .await?
            .rows_affected();

    // Keep the parent's denormalized replies_count honest. It's only ever
    // incremented on reply create, so without this it inflates forever as
    // replies are deleted. GREATEST clamps against underflow.
    if affected > 0
        && let Some(parent) = reply_to_id
    {
        let _ = sqlx::query(
            "UPDATE posts SET replies_count = GREATEST(replies_count - 1, 0) WHERE id = $1",
        )
        .bind(parent)
        .execute(&state.pg)
        .await;
    }

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
    let author_id: Option<Uuid> =
        sqlx::query_scalar("SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL")
            .bind(id)
            .fetch_optional(&state.pg)
            .await?;
    let author_id = author_id.ok_or(AppError::NotFound)?;
    if author_id != user.user_id {
        return Err(AppError::Forbidden);
    }
    let body_html = render_markdown(body);
    // Snapshot the version we're about to replace into post_edits, then update —
    // atomically in one statement. The data-modifying CTE reads `posts` as of the
    // start of the statement, so it captures the OLD body even though the main
    // UPDATE replaces it.
    sqlx::query(
        r#"
        WITH snapshot AS (
            INSERT INTO post_edits (post_id, body, body_html)
            SELECT id, body, body_html FROM posts WHERE id = $3
        )
        UPDATE posts SET body = $1, body_html = $2, edited_at = NOW(), updated_at = NOW()
        WHERE id = $3
        "#,
    )
    .bind(body)
    .bind(&body_html)
    .bind(id)
    .execute(&state.pg)
    .await?;

    // Re-index #hashtags: an edit can add or remove tags, so replace the rows.
    sync_hashtags(&state.pg, id, body).await;

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
    let target: Option<(Uuid, Uuid, String, Option<Uuid>)> = sqlx::query_as(
        r#"
        SELECT p.id, p.author_id, p.visibility, p.repost_of_id
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
    let (target_id, target_author, target_vis, target_repost_of) =
        target.ok_or(AppError::NotFound)?;
    if target_vis != "public"
        || !can_view_post_author(&state, target_author, &target_vis, Some(user.user_id)).await
    {
        return Err(AppError::Forbidden);
    }
    // No repost-of-repost chains — always boost the original.
    if target_repost_of.is_some() {
        return Err(AppError::BadRequest(
            "repost the original post, not a repost".into(),
        ));
    }
    // Idempotency: a user can repost a given target once. Re-reposting would
    // otherwise let one account flood the public timeline with copies.
    let already_reposted: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM posts WHERE author_id = $1 AND repost_of_id = $2 AND deleted_at IS NULL)",
    )
    .bind(user.user_id)
    .bind(target_id)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(false);
    if already_reposted {
        return Err(AppError::BadRequest("already reposted".into()));
    }
    // Reposts are posts — they draw from the same per-user create budget so
    // they can't bypass the anti-spam rate limit that create_post enforces.
    {
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

    // A quote-repost's body can carry #hashtags too, so index it like any post —
    // otherwise switching the feed to the table would drop quote-reposts from
    // topic feeds that the old body-regex used to match.
    sync_hashtags(&state.pg, new_id, &body).await;

    // Notify original author
    let orig_author: Option<Uuid> = sqlx::query_scalar("SELECT author_id FROM posts WHERE id = $1")
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

const VALID_EMOJI: &[&str] = &[
    "\u{1F525}",
    "\u{1F422}",
    "\u{1F91D}",
    "\u{1F64F}",
    "\u{1F602}",
];
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
    if !VALID_EMOJI.contains(&emoji) {
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

    // Did the viewer already have a reaction on this post? Only a *brand-new*
    // reaction should notify the author — toggling 🔥→🐢 (the ON CONFLICT
    // UPDATE path) must NOT re-ping them, or a single user can spam the author
    // with notifications by flipping their emoji on one post.
    let had_reaction: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM reactions WHERE post_id = $1 AND user_id = $2)",
    )
    .bind(id)
    .bind(user.user_id)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(false);

    // Upsert reaction. If user already had a reaction, replace it. Either
    // way reactions_count increments by 0 or 1; do a final recount to stay
    // consistent.
    sqlx::query(
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
    .await?;

    refresh_reactions_count(&state, id).await?;

    // Notify the post author on first reaction only. `author_id` was already
    // resolved (and visibility-checked) above — no need to re-query. notify()
    // skips self-reactions and blocked/muted actors.
    if !had_reaction {
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
        sqlx::query_scalar("SELECT emoji FROM reactions WHERE post_id = $1 AND user_id = $2")
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
pub(crate) struct PostRow {
    id: Uuid,
    author_id: Uuid,
    username: String,
    display_name: String,
    #[sqlx(default)]
    avatar_url: Option<String>,
    body: String,
    body_html: String,
    visibility: String,
    reply_to_id: Option<Uuid>,
    content_warning: Option<String>,
    reactions_count: i32,
    replies_count: i32,
    created_at: DateTime<Utc>,
    // Set when the post has been edited; drives the "edited" badge + history.
    // sqlx default → lean queries that omit the column just get None.
    #[sqlx(default)]
    edited_at: Option<DateTime<Utc>>,
    // 19 May 2026 — SQL'de EXISTS subquery ile cekilir. NULL = anonim viewer.
    #[sqlx(default)]
    viewer_reacted: Option<bool>,
    #[sqlx(default)]
    viewer_bookmarked: Option<bool>,
}

impl PostRow {
    /// Keyset cursor for this row: `(created_at, id)`. Used as the
    /// pagination tie-breaker so rows sharing a timestamp aren't skipped.
    pub(crate) fn cursor(&self) -> (DateTime<Utc>, Uuid) {
        (self.created_at, self.id)
    }

    pub(crate) fn into_view(self) -> PostView {
        PostView {
            id: self.id,
            author: AuthorView {
                id: self.author_id,
                username: self.username,
                display_name: self.display_name,
                avatar_url: self.avatar_url,
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
            edited_at: self.edited_at,
            viewer_reacted: self.viewer_reacted,
            viewer_bookmarked: self.viewer_bookmarked,
            link_preview: None,
        }
    }
}

/// Embed already-cached link previews into a page of posts (cache-only, one
/// MGET — see [`link_preview::cached_previews`]). This lets the first card's
/// cover image (the timeline's LCP) render immediately instead of waiting on a
/// per-card `/link-preview` round-trip that itself fetches the remote page.
/// Best-effort: anything not already cached is left for the client to unfurl.
pub async fn enrich_cached_previews(state: &AppState, posts: &mut [PostView]) {
    if posts.is_empty() {
        return;
    }
    let previews = {
        let bodies: Vec<&str> = posts.iter().map(|p| p.body.as_str()).collect();
        link_preview::cached_previews(&mut state.redis.clone(), &bodies).await
    };
    for (p, mut pv) in posts.iter_mut().zip(previews) {
        link_preview::absolutize_cover(&mut pv, &state.config.site_origin);
        p.link_preview = pv;
    }
}

/// Fill `viewer_reacted` / `viewer_bookmarked` on a page of posts with two indexed
/// batch lookups, instead of the per-row correlated `EXISTS` subqueries the
/// timeline/feed SQL used to carry (2×N — the dominant cost of those hot queries
/// at scale). No-op for an anonymous viewer (the flags stay `None`), which is also
/// what lets the anonymous public timeline be cached. Best-effort: on a DB error
/// the flags fall back to "not reacted/bookmarked" rather than failing the page.
pub async fn overlay_viewer_state(state: &AppState, posts: &mut [PostView], viewer: Option<Uuid>) {
    let Some(viewer) = viewer else {
        return;
    };
    if posts.is_empty() {
        return;
    }
    let ids: Vec<Uuid> = posts.iter().map(|p| p.id).collect();
    let reacted: std::collections::HashSet<Uuid> =
        sqlx::query_scalar("SELECT post_id FROM reactions WHERE user_id = $1 AND post_id = ANY($2)")
            .bind(viewer)
            .bind(&ids)
            .fetch_all(&state.pg)
            .await
            .unwrap_or_default()
            .into_iter()
            .collect();
    let bookmarked: std::collections::HashSet<Uuid> =
        sqlx::query_scalar("SELECT post_id FROM bookmarks WHERE user_id = $1 AND post_id = ANY($2)")
            .bind(viewer)
            .bind(&ids)
            .fetch_all(&state.pg)
            .await
            .unwrap_or_default()
            .into_iter()
            .collect();
    for p in posts.iter_mut() {
        p.viewer_reacted = Some(reacted.contains(&p.id));
        p.viewer_bookmarked = Some(bookmarked.contains(&p.id));
    }
}

async fn attach_parent(state: &AppState, view: &mut PostView, viewer: Option<Uuid>) {
    let Some(parent_id) = view.reply_to_id else {
        return;
    };
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
        "followers" => viewer_id == author_id
            || sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2)",
            )
            .bind(viewer_id)
            .bind(author_id)
            .fetch_one(&state.pg)
            .await
            .unwrap_or(false),
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
            p.id, p.author_id, u.username, u.display_name, u.avatar_url,
            p.body, p.body_html, p.visibility, p.reply_to_id, p.content_warning,
            p.reactions_count, p.replies_count, p.created_at, p.edited_at,
            CASE WHEN $2::uuid IS NOT NULL THEN
                EXISTS(SELECT 1 FROM reactions r WHERE r.post_id = p.id AND r.user_id = $2)
            ELSE NULL END AS viewer_reacted,
            CASE WHEN $2::uuid IS NOT NULL THEN
                EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = $2)
            ELSE NULL END AS viewer_bookmarked
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
            p.id, p.author_id, u.username, u.display_name, u.avatar_url,
            p.body, p.body_html, p.visibility, p.reply_to_id, p.content_warning,
            p.reactions_count, p.replies_count, p.created_at, p.edited_at,
            CASE WHEN $3::uuid IS NOT NULL THEN
                EXISTS(SELECT 1 FROM reactions r WHERE r.post_id = p.id AND r.user_id = $3)
            ELSE NULL END AS viewer_reacted,
            CASE WHEN $3::uuid IS NOT NULL THEN
                EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = $3)
            ELSE NULL END AS viewer_bookmarked
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.reply_to_id = $1
          AND p.moderation_state = 'live'
          AND p.deleted_at IS NULL
          AND ((p.created_at < $2) OR (p.created_at = $2 AND p.id < $5))
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
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $4
        "#,
    )
    .bind(id)
    .bind(before)
    .bind(viewer_id)
    .bind(limit)
    .bind(q.before_id.unwrap_or(Uuid::nil()))
    .fetch_all(&state.pg)
    .await?;

    let next = rows.last().map(|r| (r.created_at, r.id));
    let posts = rows.into_iter().map(PostRow::into_view).collect();
    Ok(Json(TimelineResponse {
        posts,
        next_before: next.map(|(t, _)| t),
        next_before_id: next.map(|(_, id)| id),
    }))
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
            p.id, p.author_id, u.username, u.display_name, u.avatar_url,
            p.body, p.body_html, p.visibility, p.reply_to_id, p.content_warning,
            p.reactions_count, p.replies_count, p.created_at, p.edited_at,
            CASE WHEN $2::uuid IS NOT NULL THEN
                EXISTS(SELECT 1 FROM reactions r WHERE r.post_id = p.id AND r.user_id = $2)
            ELSE NULL END AS viewer_reacted,
            CASE WHEN $2::uuid IS NOT NULL THEN
                EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = $2)
            ELSE NULL END AS viewer_bookmarked
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

    let descendants = descendants_rows
        .into_iter()
        .map(PostRow::into_view)
        .collect();
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
