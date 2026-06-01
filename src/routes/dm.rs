// /api/v1/dm — direct messages.
//
//   GET    /dm/threads                       → thread list (+last msg + unread)
//   GET    /dm/threads/{username}            → upsert thread + paginated history
//   POST   /dm/threads/{username}            → send message
//   PATCH  /dm/threads/{username}/read       → mark all in thread read
//   DELETE /dm/messages/{id}                 → soft-delete own message
//
// Anti-abuse: a DM only goes through if sender and recipient are mutual
// followers (each follows the other). Same instance, no federation, no
// extra moderation layer yet.
//
// Realtime: every accepted message also publishes a NotificationEvent
// with kind="dm" to the existing broadcast channel; the recipient's
// open SSE connection picks it up and the SPA refetches the thread.

use crate::{
    content::render_markdown,
    errors::AppError,
    middleware::session::CurrentUser,
    state::{AppState, NotificationEvent},
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, patch},
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/threads", get(list_threads))
        .route("/threads/{username}", get(thread).post(send))
        .route("/threads/{username}/read", patch(mark_read))
        .route("/messages/{id}", delete(delete_message))
}

const MAX_DM_LEN: usize = 5000;
// Per-sender DM throttle. Each accepted message fans out an SSE event +
// push to the recipient, so an unbounded send rate is a message/push-bomb
// vector even between mutual followers.
const DM_RATE_LIMIT_MAX: u32 = 20;
const DM_RATE_LIMIT_WINDOW_SECS: u64 = 60;

fn canonical_pair(a: Uuid, b: Uuid) -> (Uuid, Uuid) {
    if a < b { (a, b) } else { (b, a) }
}

// ─── GET /dm/threads ────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
pub struct ThreadSummary {
    id: Uuid,
    other_id: Uuid,
    other_username: String,
    other_display_name: String,
    other_avatar_url: Option<String>,
    last_body: Option<String>,
    last_sender_id: Option<Uuid>,
    last_message_at: DateTime<Utc>,
    unread_count: i64,
}

async fn list_threads(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<Vec<ThreadSummary>>, AppError> {
    let rows: Vec<ThreadSummary> = sqlx::query_as(
        r#"
        WITH my AS (
            SELECT id, a_id, b_id, last_message_at
            FROM dm_threads
            WHERE (a_id = $1 OR b_id = $1)
              AND EXISTS (
                  SELECT 1 FROM dm_messages m
                  WHERE m.thread_id = dm_threads.id AND m.deleted_at IS NULL
              )
        )
        SELECT
            my.id,
            CASE WHEN my.a_id = $1 THEN my.b_id ELSE my.a_id END AS other_id,
            u.username AS other_username,
            u.display_name AS other_display_name,
            u.avatar_url AS other_avatar_url,
            (SELECT body FROM dm_messages m WHERE m.thread_id = my.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_body,
            (SELECT sender_id FROM dm_messages m WHERE m.thread_id = my.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS last_sender_id,
            my.last_message_at,
            (SELECT COUNT(*)::bigint FROM dm_messages m WHERE m.thread_id = my.id AND m.sender_id <> $1 AND m.read_at IS NULL AND m.deleted_at IS NULL) AS unread_count
        FROM my
        JOIN users u ON u.id = (CASE WHEN my.a_id = $1 THEN my.b_id ELSE my.a_id END)
        WHERE u.role <> 'suspended'
          AND NOT EXISTS (
              SELECT 1 FROM user_blocks b
              WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
                 OR (b.blocker_id = u.id AND b.blocked_id = $1)
          )
        ORDER BY my.last_message_at DESC
        LIMIT 100
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ─── GET /dm/threads/{username} ────────────────────────────────

#[derive(Deserialize)]
pub struct PageQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    before: Option<DateTime<Utc>>,
}
fn default_limit() -> i64 {
    50
}

#[derive(Serialize)]
pub struct ThreadView {
    id: Option<Uuid>,
    other_username: String,
    other_display_name: String,
    mutual_follow: bool,
    // 19 May 2026 — Frontend "takip et" CTA'si: mutual=false durumunda
    // is_following=false ise "takip et" butonu, is_following=true ise
    // "o seni takip etmeli" mesaji. Onceden sadece "mutual_required" banner
    // vardi, kullanici "mesajlasma aktif olmuyor" diye sikayet ediyordu.
    is_following: bool,
    is_followed_by: bool,
    messages: Vec<DmMessage>,
    next_before: Option<DateTime<Utc>>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct DmMessage {
    id: Uuid,
    sender_id: Uuid,
    body: String,
    body_html: String,
    read_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

async fn thread(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(username): Path<String>,
    Query(q): Query<PageQuery>,
) -> Result<Json<ThreadView>, AppError> {
    let other = lookup_user(&state, &username).await?;
    if other.0 == user.user_id {
        return Err(AppError::BadRequest("cannot DM yourself".into()));
    }
    if is_blocked(&state, user.user_id, other.0).await {
        return Err(AppError::Forbidden);
    }
    let (a, b) = canonical_pair(user.user_id, other.0);
    // 19 May 2026 — Tek query'de iki follow yonu cek (mutual + asimetrik state).
    let follow_state: Option<(bool, bool)> = sqlx::query_as(
        r#"
        SELECT
            EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2) AS is_following,
            EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = $1) AS is_followed_by
        "#,
    )
    .bind(user.user_id)
    .bind(other.0)
    .fetch_optional(&state.pg)
    .await
    .ok()
    .flatten();
    let (is_following, is_followed_by) = follow_state.unwrap_or((false, false));
    let mutual = is_following && is_followed_by;

    let thread_id: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM dm_threads WHERE a_id = $1 AND b_id = $2")
            .bind(a)
            .bind(b)
            .fetch_optional(&state.pg)
            .await?;

    let limit = q.limit.clamp(1, 200);
    let before = q.before.unwrap_or_else(Utc::now);
    let rows: Vec<DmMessage> = if let Some(thread_id) = thread_id {
        sqlx::query_as(
            r#"
            SELECT id, sender_id, body, body_html, read_at, created_at
            FROM dm_messages
            WHERE thread_id = $1 AND deleted_at IS NULL AND created_at < $2
            ORDER BY created_at DESC
            LIMIT $3
            "#,
        )
        .bind(thread_id)
        .bind(before)
        .bind(limit)
        .fetch_all(&state.pg)
        .await?
    } else {
        Vec::new()
    };

    let next_before = rows.last().map(|r| r.created_at);
    let mut messages = rows;
    messages.reverse(); // chronological for UI

    Ok(Json(ThreadView {
        id: thread_id,
        other_username: other.1,
        other_display_name: other.2,
        mutual_follow: mutual,
        is_following,
        is_followed_by,
        messages,
        next_before,
    }))
}

// ─── POST /dm/threads/{username} ───────────────────────────────

#[derive(Deserialize)]
pub struct SendBody {
    body: String,
}

async fn send(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(username): Path<String>,
    Json(input): Json<SendBody>,
) -> Result<(StatusCode, Json<DmMessage>), AppError> {
    let body = input.body.trim();
    if body.is_empty() {
        return Err(AppError::BadRequest("body required".into()));
    }
    if body.chars().count() > MAX_DM_LEN {
        return Err(AppError::BadRequest(format!(
            "body too long (max {MAX_DM_LEN})"
        )));
    }

    let other = lookup_user(&state, &username).await?;
    if other.0 == user.user_id {
        return Err(AppError::BadRequest("cannot DM yourself".into()));
    }
    if is_blocked(&state, user.user_id, other.0).await {
        return Err(AppError::Forbidden);
    }
    if !mutual_follow(&state, user.user_id, other.0).await {
        return Err(AppError::Forbidden);
    }

    // Anti-spam throttle (per sender, fixed window).
    {
        let mut redis = state.redis.clone();
        let key = format!("rl:dm:send:{}", user.user_id);
        let count: u32 = redis.incr(&key, 1u32).await?;
        if count == 1 {
            let _: () = redis.expire(&key, DM_RATE_LIMIT_WINDOW_SECS as i64).await?;
        }
        if count > DM_RATE_LIMIT_MAX {
            return Err(AppError::RateLimited);
        }
    }

    let (a, b) = canonical_pair(user.user_id, other.0);

    let thread_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO dm_threads (a_id, b_id) VALUES ($1, $2)
        ON CONFLICT (a_id, b_id) DO UPDATE SET last_message_at = NOW()
        RETURNING id
        "#,
    )
    .bind(a)
    .bind(b)
    .fetch_one(&state.pg)
    .await?;

    let body_html = render_markdown(body);
    let msg: DmMessage = sqlx::query_as(
        r#"
        INSERT INTO dm_messages (thread_id, sender_id, body, body_html)
        VALUES ($1, $2, $3, $4)
        RETURNING id, sender_id, body, body_html, read_at, created_at
        "#,
    )
    .bind(thread_id)
    .bind(user.user_id)
    .bind(body)
    .bind(&body_html)
    .fetch_one(&state.pg)
    .await?;

    // Bump thread last_message_at (in case ON CONFLICT didn't fire)
    let _ = sqlx::query("UPDATE dm_threads SET last_message_at = NOW() WHERE id = $1")
        .bind(thread_id)
        .execute(&state.pg)
        .await;

    // SSE signal to recipient (no body — they refetch from API to read)
    let sender_username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(user.user_id)
        .fetch_one(&state.pg)
        .await
        .unwrap_or_default();
    if !is_muted(&state, other.0, user.user_id).await {
        let _ = state.notif_tx.send(NotificationEvent {
            user_id: other.0,
            kind: "dm".into(),
            actor_id: Some(user.user_id),
            actor_username: Some(sender_username),
            target_kind: "thread".into(),
            target_id: thread_id,
            created_at: Utc::now().to_rfc3339(),
        });
    }

    Ok((StatusCode::CREATED, Json(msg)))
}

// ─── PATCH /dm/threads/{username}/read ─────────────────────────

async fn mark_read(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(username): Path<String>,
) -> Result<StatusCode, AppError> {
    let other = lookup_user(&state, &username).await?;
    // Match the block enforcement that thread()/send() apply — don't let a
    // blocked relationship still flip read-receipts across the boundary.
    if is_blocked(&state, user.user_id, other.0).await {
        return Err(AppError::Forbidden);
    }
    let (a, b) = canonical_pair(user.user_id, other.0);
    let tid: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM dm_threads WHERE a_id = $1 AND b_id = $2")
            .bind(a)
            .bind(b)
            .fetch_optional(&state.pg)
            .await?;
    if let Some(tid) = tid {
        sqlx::query(
            r#"
            UPDATE dm_messages SET read_at = NOW()
            WHERE thread_id = $1 AND sender_id <> $2 AND read_at IS NULL
            "#,
        )
        .bind(tid)
        .bind(user.user_id)
        .execute(&state.pg)
        .await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

// ─── DELETE /dm/messages/{id} ──────────────────────────────────

async fn delete_message(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let thread_id: Option<Uuid> = sqlx::query_scalar(
        "UPDATE dm_messages SET deleted_at = NOW() WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL RETURNING thread_id",
    )
    .bind(id)
    .bind(user.user_id)
    .fetch_optional(&state.pg)
    .await?;
    let Some(thread_id) = thread_id else {
        return Err(AppError::NotFound);
    };
    let _ = sqlx::query(
        r#"
        UPDATE dm_threads
        SET last_message_at = COALESCE(
            (SELECT MAX(created_at) FROM dm_messages WHERE thread_id = $1 AND deleted_at IS NULL),
            created_at
        )
        WHERE id = $1
        "#,
    )
    .bind(thread_id)
    .execute(&state.pg)
    .await;
    Ok(StatusCode::NO_CONTENT)
}

// ─── helpers ───────────────────────────────────────────────────

async fn lookup_user(state: &AppState, username: &str) -> Result<(Uuid, String, String), AppError> {
    let row: Option<(Uuid, String, String)> = sqlx::query_as(
        "SELECT id, username, display_name FROM users WHERE username = $1 AND role <> 'suspended'",
    )
    .bind(username)
    .fetch_optional(&state.pg)
    .await?;
    row.ok_or(AppError::NotFound)
}

async fn mutual_follow(state: &AppState, a: Uuid, b: Uuid) -> bool {
    let row: Option<bool> = sqlx::query_scalar(
        r#"
        SELECT
            EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2)
            AND
            EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = $1)
        "#,
    )
    .bind(a)
    .bind(b)
    .fetch_optional(&state.pg)
    .await
    .ok()
    .flatten();
    row.unwrap_or(false)
}

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

async fn is_muted(state: &AppState, muter: Uuid, muted: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM user_mutes WHERE muter_id = $1 AND muted_id = $2)",
    )
    .bind(muter)
    .bind(muted)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(false)
}
