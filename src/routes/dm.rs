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
    routing::{delete, get, patch, post},
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/threads", get(list_threads))
        .route("/threads/clear", post(bulk_clear))
        .route("/threads/{username}", get(thread).post(send).delete(clear_thread))
        .route("/threads/{username}/read", patch(mark_read))
        .route("/threads/{username}/typing", post(typing))
        .route("/messages/delete", post(bulk_delete))
        .route("/messages/{id}", delete(delete_message))
        .route("/messages/{id}/react", post(react_message).delete(unreact_message))
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
            SELECT id, a_id, b_id, last_message_at,
                   COALESCE(CASE WHEN a_id = $1 THEN a_cleared_at ELSE b_cleared_at END, '-infinity'::timestamptz) AS cleared
            FROM dm_threads
            WHERE (a_id = $1 OR b_id = $1)
        )
        SELECT
            my.id,
            CASE WHEN my.a_id = $1 THEN my.b_id ELSE my.a_id END AS other_id,
            u.username AS other_username,
            u.display_name AS other_display_name,
            u.avatar_url AS other_avatar_url,
            (SELECT body FROM dm_messages m WHERE m.thread_id = my.id AND m.deleted_at IS NULL AND m.created_at > my.cleared ORDER BY m.created_at DESC LIMIT 1) AS last_body,
            (SELECT sender_id FROM dm_messages m WHERE m.thread_id = my.id AND m.deleted_at IS NULL AND m.created_at > my.cleared ORDER BY m.created_at DESC LIMIT 1) AS last_sender_id,
            my.last_message_at,
            (SELECT COUNT(*)::bigint FROM dm_messages m WHERE m.thread_id = my.id AND m.sender_id <> $1 AND m.read_at IS NULL AND m.deleted_at IS NULL AND m.created_at > my.cleared) AS unread_count
        FROM my
        JOIN users u ON u.id = (CASE WHEN my.a_id = $1 THEN my.b_id ELSE my.a_id END)
        WHERE u.role <> 'suspended'
          AND EXISTS (
              SELECT 1 FROM dm_messages m
              WHERE m.thread_id = my.id AND m.deleted_at IS NULL AND m.created_at > my.cleared
          )
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
    other_avatar_url: Option<String>,
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
    media_url: Option<String>,
    media_kind: Option<String>,
    read_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    reactions: Vec<DmReactionView>,
}

#[derive(Serialize, Clone)]
pub struct DmReactionView {
    emoji: String,
    count: i64,
    mine: bool,
}

// Same small reaction allowlist as posts: fire / turtle / handshake / pray / joy.
const VALID_DM_EMOJI: &[&str] =
    &["\u{1F525}", "\u{1F422}", "\u{1F91D}", "\u{1F64F}", "\u{1F602}"];

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

    let thread_row: Option<(Uuid, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT id, CASE WHEN a_id = $3 THEN a_cleared_at ELSE b_cleared_at END FROM dm_threads WHERE a_id = $1 AND b_id = $2",
    )
    .bind(a)
    .bind(b)
    .bind(user.user_id)
    .fetch_optional(&state.pg)
    .await?;
    let thread_id = thread_row.as_ref().map(|r| r.0);
    let cleared: Option<DateTime<Utc>> = thread_row.and_then(|r| r.1);

    let limit = q.limit.clamp(1, 200);
    let before = q.before.unwrap_or_else(Utc::now);
    let mut rows: Vec<DmMessage> = if let Some(thread_id) = thread_id {
        sqlx::query_as(
            r#"
            SELECT id, sender_id, body, body_html, media_url, media_kind, read_at, created_at
            FROM dm_messages
            WHERE thread_id = $1 AND deleted_at IS NULL AND created_at < $2
              AND created_at > COALESCE($4, '-infinity'::timestamptz)
            ORDER BY created_at DESC
            LIMIT $3
            "#,
        )
        .bind(thread_id)
        .bind(before)
        .bind(limit)
        .bind(cleared)
        .fetch_all(&state.pg)
        .await?
    } else {
        Vec::new()
    };

    // Attach reactions for the page of messages in a single round-trip.
    if !rows.is_empty() {
        let ids: Vec<Uuid> = rows.iter().map(|m| m.id).collect();
        let rx: Vec<(Uuid, String, i64, bool)> = sqlx::query_as(
            r#"
            SELECT message_id, emoji, COUNT(*)::bigint AS count,
                   bool_or(user_id = $2) AS mine
            FROM dm_reactions
            WHERE message_id = ANY($1)
            GROUP BY message_id, emoji
            ORDER BY count DESC
            "#,
        )
        .bind(&ids)
        .bind(user.user_id)
        .fetch_all(&state.pg)
        .await
        .unwrap_or_default();
        for m in rows.iter_mut() {
            m.reactions = rx
                .iter()
                .filter(|(mid, ..)| *mid == m.id)
                .map(|(_, emoji, count, mine)| DmReactionView {
                    emoji: emoji.clone(),
                    count: *count,
                    mine: *mine,
                })
                .collect();
        }
    }

    let next_before = rows.last().map(|r| r.created_at);
    let mut messages = rows;
    messages.reverse(); // chronological for UI

    Ok(Json(ThreadView {
        id: thread_id,
        other_username: other.1,
        other_display_name: other.2,
        other_avatar_url: other.3.clone(),
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
    #[serde(default)]
    body: String,
    // The attachment is referenced by URL; its kind is taken from the media
    // table at send time (a client-sent kind is ignored, hence not a field).
    media_url: Option<String>,
}

async fn send(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(username): Path<String>,
    Json(input): Json<SendBody>,
) -> Result<(StatusCode, Json<DmMessage>), AppError> {
    let body = input.body.trim();
    let media_url = input.media_url.as_deref().map(str::trim).filter(|s| !s.is_empty());
    // Validate any attachment against the media table: it must be a /media/ file
    // the SENDER uploaded, and the *stored* kind (not the client's claim) is what
    // we record. Stops forging arbitrary URLs or mislabeling kinds.
    let media_kind: Option<String> = if let Some(u) = media_url {
        let fname = u
            .strip_prefix("/media/")
            .filter(|f| !f.is_empty() && !f.contains('/'));
        let Some(fname) = fname else {
            return Err(AppError::BadRequest("media_url must be a /media/ path".into()));
        };
        match sqlx::query_scalar::<_, String>(
            "SELECT kind FROM media WHERE owner_id = $1 AND filename = $2",
        )
        .bind(user.user_id)
        .bind(fname)
        .fetch_optional(&state.pg)
        .await?
        {
            Some(k) => Some(k),
            None => return Err(AppError::BadRequest("media not found or not yours".into())),
        }
    } else {
        None
    };
    if body.is_empty() && media_url.is_none() {
        return Err(AppError::BadRequest("body or media required".into()));
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
        INSERT INTO dm_messages (thread_id, sender_id, body, body_html, media_url, media_kind)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, sender_id, body, body_html, media_url, media_kind, read_at, created_at
        "#,
    )
    .bind(thread_id)
    .bind(user.user_id)
    .bind(body)
    .bind(&body_html)
    .bind(media_url)
    .bind(media_kind)
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
            actor_username: Some(sender_username.clone()),
            target_kind: "thread".into(),
            target_id: thread_id,
            created_at: Utc::now().to_rfc3339(),
        });
        // Native push (Expo → FCM/APNs) so the recipient is alerted — with sound —
        // even with the app closed. No-op until they've registered a device token.
        crate::routes::push::send_to_device_tokens(
            &state,
            other.0,
            "dm",
            Some(sender_username.as_str()),
            "thread",
            thread_id,
        )
        .await;
    }

    Ok((StatusCode::CREATED, Json(msg)))
}

// ─── POST /dm/threads/{username}/typing — ephemeral "is typing" ping ───
// No DB write: just broadcasts a transient NotificationEvent to the recipient's
// SSE stream. Throttled per (sender → recipient) so a fast typist can't flood.
async fn typing(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(username): Path<String>,
) -> Result<StatusCode, AppError> {
    let other = lookup_user(&state, &username).await?;
    if other.0 == user.user_id {
        return Ok(StatusCode::NO_CONTENT);
    }
    let mut redis = state.redis.clone();
    let key = format!("dm:typing:{}:{}", user.user_id, other.0);
    let fresh: bool = redis.set_nx(&key, 1u8).await.unwrap_or(false);
    if !fresh {
        return Ok(StatusCode::NO_CONTENT); // throttled (a ping went out <2s ago)
    }
    let _: () = redis.expire(&key, 2).await.unwrap_or(());

    if mutual_follow(&state, user.user_id, other.0).await
        && !is_muted(&state, other.0, user.user_id).await
    {
        let sender_username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
            .bind(user.user_id)
            .fetch_one(&state.pg)
            .await
            .unwrap_or_default();
        let _ = state.notif_tx.send(NotificationEvent {
            user_id: other.0,
            kind: "typing".into(),
            actor_id: Some(user.user_id),
            actor_username: Some(sender_username),
            target_kind: "thread".into(),
            target_id: Uuid::nil(),
            created_at: Utc::now().to_rfc3339(),
        });
    }
    Ok(StatusCode::NO_CONTENT)
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

// ─── POST /dm/messages/delete — bulk soft-delete own messages ──────

#[derive(Deserialize)]
pub struct BulkDeleteBody {
    ids: Vec<Uuid>,
}

async fn bulk_delete(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<BulkDeleteBody>,
) -> Result<StatusCode, AppError> {
    if input.ids.is_empty() {
        return Ok(StatusCode::NO_CONTENT);
    }
    let mut threads: Vec<Uuid> = sqlx::query_scalar(
        r#"
        UPDATE dm_messages SET deleted_at = NOW()
        WHERE id = ANY($1) AND sender_id = $2 AND deleted_at IS NULL
        RETURNING thread_id
        "#,
    )
    .bind(&input.ids)
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await?;
    threads.sort();
    threads.dedup();
    for tid in threads {
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
        .bind(tid)
        .execute(&state.pg)
        .await;
    }
    Ok(StatusCode::NO_CONTENT)
}

// ─── POST / DELETE /dm/messages/{id}/react ─────────────────────────

#[derive(Deserialize)]
pub struct DmReactBody {
    emoji: String,
}

async fn react_message(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
    Json(input): Json<DmReactBody>,
) -> Result<StatusCode, AppError> {
    let emoji = input.emoji.trim();
    if !VALID_DM_EMOJI.contains(&emoji) {
        return Err(AppError::BadRequest("invalid emoji".into()));
    }
    // Must be a live message in a thread the viewer belongs to; resolve the other
    // party so a blocked relationship can't keep reacting across the boundary.
    let other: Option<Uuid> = sqlx::query_scalar(
        r#"
        SELECT CASE WHEN t.a_id = $2 THEN t.b_id ELSE t.a_id END
        FROM dm_messages m
        JOIN dm_threads t ON t.id = m.thread_id
        WHERE m.id = $1 AND m.deleted_at IS NULL AND ($2 = t.a_id OR $2 = t.b_id)
        "#,
    )
    .bind(id)
    .bind(user.user_id)
    .fetch_optional(&state.pg)
    .await?;
    let Some(other) = other else {
        return Err(AppError::NotFound);
    };
    if is_blocked(&state, user.user_id, other).await {
        return Err(AppError::Forbidden);
    }
    sqlx::query(
        r#"
        INSERT INTO dm_reactions (message_id, user_id, emoji)
        VALUES ($1, $2, $3)
        ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji
        "#,
    )
    .bind(id)
    .bind(user.user_id)
    .bind(emoji)
    .execute(&state.pg)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn unreact_message(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    sqlx::query("DELETE FROM dm_reactions WHERE message_id = $1 AND user_id = $2")
        .bind(id)
        .bind(user.user_id)
        .execute(&state.pg)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── DELETE /dm/threads/{username} — "delete conversation" (per-user) ──

async fn clear_thread(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(username): Path<String>,
) -> Result<StatusCode, AppError> {
    let other = lookup_user(&state, &username).await?;
    if other.0 == user.user_id {
        return Err(AppError::BadRequest("cannot clear self".into()));
    }
    let (a, b) = canonical_pair(user.user_id, other.0);
    // `col` is one of two fixed identifiers, never user input — safe to format in.
    let col = if user.user_id == a { "a_cleared_at" } else { "b_cleared_at" };
    let sql = format!("UPDATE dm_threads SET {col} = NOW() WHERE a_id = $1 AND b_id = $2");
    sqlx::query(&sql).bind(a).bind(b).execute(&state.pg).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── POST /dm/threads/clear — bulk "delete conversation" by thread id ──

#[derive(Deserialize)]
pub struct BulkClearBody {
    ids: Vec<Uuid>,
}

async fn bulk_clear(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<BulkClearBody>,
) -> Result<StatusCode, AppError> {
    if input.ids.is_empty() {
        return Ok(StatusCode::NO_CONTENT);
    }
    sqlx::query("UPDATE dm_threads SET a_cleared_at = NOW() WHERE id = ANY($1) AND a_id = $2")
        .bind(&input.ids)
        .bind(user.user_id)
        .execute(&state.pg)
        .await?;
    sqlx::query("UPDATE dm_threads SET b_cleared_at = NOW() WHERE id = ANY($1) AND b_id = $2")
        .bind(&input.ids)
        .bind(user.user_id)
        .execute(&state.pg)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── helpers ───────────────────────────────────────────────────

async fn lookup_user(
    state: &AppState,
    username: &str,
) -> Result<(Uuid, String, String, Option<String>), AppError> {
    let row: Option<(Uuid, String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, username, display_name, avatar_url FROM users WHERE username = $1 AND role <> 'suspended'",
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
