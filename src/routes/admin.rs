// /api/v1/admin — admin-only moderation surface.
//
// Every state-changing action writes a row to `moderation_log` so we have
// an append-only record of who did what, when, and why. Admin actions here log
// with `actor_kind='admin'`; automated decisions (e.g. spam auto-quarantine in
// the post pipeline) log to the same table with `actor_kind='ai'` via the shared
// `crate::moderation::log_action` writer.
//
// Endpoints:
//   GET    /admin/posts?state=live|quarantine|removed|all  → recent posts
//   PATCH  /admin/posts/{id}                               → change moderation_state (+reason)
//   GET    /admin/users                                    → recent + counts
//   PATCH  /admin/users/{id}                               → suspend / unsuspend (role)
//   GET    /admin/login_attempts?outcome=...               → recent failures
//   GET    /admin/audit?status_min=400                     → recent error responses
//   GET    /admin/sessions?flagged=1                       → flagged (hijack-suspected) sessions
//   GET    /admin/moderation_log                           → recent actions

use crate::{
    errors::AppError,
    middleware::auth_extractor::AdminUser,
    moderation::{Actor, log_action},
    search::{PostDoc, Search},
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

type SearchPostRow = (
    Uuid,
    String,
    String,
    String,
    String,
    DateTime<Utc>,
    i32,
    i32,
);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/stats", get(stats))
        .route("/posts", get(list_posts))
        .route("/posts/{id}", patch(patch_post))
        .route("/users", get(list_users))
        .route("/users/{id}", patch(patch_user))
        .route("/users/{id}/shadow", patch(patch_user_shadow))
        .route("/login_attempts", get(login_attempts))
        .route("/audit", get(audit))
        .route("/sessions", get(sessions))
        .route("/moderation_log", get(mod_log))
        .route("/federation/instances", get(fed_instances))
        .route("/federation/blocks", post(fed_block))
        .route("/federation/blocks/{host}", delete(fed_unblock))
        .route(
            "/federation/relays",
            get(fed_relays).post(fed_relay_subscribe).delete(fed_relay_unsubscribe),
        )
        .route(
            "/federation/remote_posts",
            get(fed_remote_posts).patch(fed_remote_post_hide),
        )
}

// ─── Federation: instance list + defederation blocklist ─────────

#[derive(Serialize, sqlx::FromRow)]
struct FedInstance {
    host: String,
    followers: i64,
    blocked: bool,
    reason: Option<String>,
}

async fn fed_instances(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<FedInstance>>, AppError> {
    // Known instances (with remote-follower counts) unioned with blocked hosts
    // that may have no actors yet.
    let rows: Vec<FedInstance> = sqlx::query_as(
        r#"
        SELECT host,
               SUM(followers)::bigint AS followers,
               bool_or(blocked)       AS blocked,
               MAX(reason)            AS reason
        FROM (
            SELECT fa.host AS host,
                   COUNT(DISTINCT ff.local_user_id) AS followers,
                   false AS blocked,
                   NULL::text AS reason
            FROM federation_actors fa
            LEFT JOIN federation_followers ff ON ff.remote_actor_uri = fa.uri
            GROUP BY fa.host
            UNION ALL
            SELECT host, 0, true, reason FROM federation_blocks
        ) x
        GROUP BY host
        ORDER BY blocked DESC, followers DESC, host
        LIMIT 200
        "#,
    )
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct BlockBody {
    host: String,
    #[serde(default)]
    reason: Option<String>,
}

fn normalize_host(raw: &str) -> Option<String> {
    let h = raw.trim().trim_start_matches("https://").trim_start_matches("http://");
    let h = h.split('/').next().unwrap_or("").to_lowercase();
    if h.is_empty()
        || h.len() > 253
        || !h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return None;
    }
    Some(h)
}

async fn fed_block(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(input): Json<BlockBody>,
) -> Result<StatusCode, AppError> {
    let host = normalize_host(&input.host)
        .ok_or_else(|| AppError::BadRequest("invalid host".into()))?;
    // The federation_blocks row (host, reason, created_at) is the audit record.
    sqlx::query(
        "INSERT INTO federation_blocks (host, reason) VALUES ($1, $2)
         ON CONFLICT (host) DO UPDATE SET reason = EXCLUDED.reason",
    )
    .bind(&host)
    .bind(input.reason.as_deref())
    .execute(&state.pg)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn fed_unblock(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(host): Path<String>,
) -> Result<StatusCode, AppError> {
    sqlx::query("DELETE FROM federation_blocks WHERE host = $1")
        .bind(host.to_lowercase())
        .execute(&state.pg)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Federation: relay subscriptions ────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
struct RelayRow {
    actor_uri: String,
    inbox: String,
    state: String,
    subscribed_at: DateTime<Utc>,
    accepted_at: Option<DateTime<Utc>>,
}

async fn fed_relays(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<RelayRow>>, AppError> {
    let rows: Vec<RelayRow> = sqlx::query_as(
        "SELECT actor_uri, inbox, state, subscribed_at, accepted_at FROM federation_relays ORDER BY subscribed_at DESC",
    )
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct RelayBody {
    actor_uri: String,
}

/// Subscribe to a relay by its actor URI — sends a signed Follow from the
/// instance actor. Activates once the relay's Accept lands at the instance inbox.
async fn fed_relay_subscribe(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(input): Json<RelayBody>,
) -> Result<StatusCode, AppError> {
    let uri = input.actor_uri.trim();
    if !uri.starts_with("https://") {
        return Err(AppError::BadRequest("relay actor must be an https URL".into()));
    }
    crate::federation::subscribe_relay(&state, uri)
        .await
        .map_err(AppError::Internal)?;
    Ok(StatusCode::ACCEPTED)
}

async fn fed_relay_unsubscribe(
    State(state): State<AppState>,
    _admin: AdminUser,
    Query(input): Query<RelayBody>,
) -> Result<StatusCode, AppError> {
    crate::federation::unsubscribe_relay(&state, input.actor_uri.trim())
        .await
        .map_err(AppError::Internal)?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Federation: remote-post moderation ─────────────────────────
//
// Per-post moderation for consumed federated content. Host-blocks defederate a
// whole instance; this hides a single remote post from the explore feed (the
// `hidden` flag from migration 0038 — until now it had no surface). Like the
// defederation blocklist, the flipped row itself is the audit record.

#[derive(Serialize, sqlx::FromRow)]
struct RemotePostRow {
    uri: String,
    actor_uri: String,
    actor_handle: Option<String>,
    content_html: String,
    published_at: DateTime<Utc>,
    hidden: bool,
}

async fn fed_remote_posts(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<RemotePostRow>>, AppError> {
    let rows: Vec<RemotePostRow> = sqlx::query_as(
        r#"
        SELECT uri, actor_uri, actor_handle,
               left(content_html, 400) AS content_html,
               published_at, hidden
        FROM remote_posts
        ORDER BY ingested_at DESC
        LIMIT 100
        "#,
    )
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct RemotePostHideBody {
    uri: String,
    hidden: bool,
}

async fn fed_remote_post_hide(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(input): Json<RemotePostHideBody>,
) -> Result<StatusCode, AppError> {
    let n = sqlx::query("UPDATE remote_posts SET hidden = $2 WHERE uri = $1")
        .bind(&input.uri)
        .bind(input.hidden)
        .execute(&state.pg)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
pub struct Stats {
    total_users: i64,
    new_users_24h: i64,
    dau_24h: i64, // distinct users with a session row updated in 24h
    total_posts: i64,
    posts_24h: i64,
    reactions_24h: i64,
    follows_24h: i64,
    requests_24h: i64, // audit_log rows in 24h
    errors_24h: i64,   // audit_log with status >= 500 in 24h
    flagged_sessions: i64,
    pending_mod_posts: i64, // moderation_state = 'quarantine'
    dm_messages_24h: i64,
    media_total: i64,
    media_bytes: i64,
}

async fn stats(State(state): State<AppState>, _a: AdminUser) -> Result<Json<Stats>, AppError> {
    macro_rules! scalar {
        ($pg:expr, $sql:expr) => {{
            let r: i64 = sqlx::query_scalar($sql).fetch_one($pg).await.unwrap_or(0);
            r
        }};
    }
    let pg = &state.pg;
    let s = Stats {
        total_users: scalar!(pg, "SELECT COUNT(*) FROM users"),
        new_users_24h: scalar!(
            pg,
            "SELECT COUNT(*) FROM users WHERE created_at > NOW() - interval '24 hours'"
        ),
        dau_24h: scalar!(
            pg,
            "SELECT COUNT(DISTINCT user_id) FROM sessions WHERE last_seen_at > NOW() - interval '24 hours'"
        ),
        total_posts: scalar!(pg, "SELECT COUNT(*) FROM posts WHERE deleted_at IS NULL"),
        posts_24h: scalar!(
            pg,
            "SELECT COUNT(*) FROM posts WHERE deleted_at IS NULL AND created_at > NOW() - interval '24 hours'"
        ),
        reactions_24h: scalar!(
            pg,
            "SELECT COUNT(*) FROM reactions WHERE created_at > NOW() - interval '24 hours'"
        ),
        follows_24h: scalar!(
            pg,
            "SELECT COUNT(*) FROM follows WHERE created_at > NOW() - interval '24 hours'"
        ),
        requests_24h: scalar!(
            pg,
            "SELECT COUNT(*) FROM audit_log WHERE ts > NOW() - interval '24 hours'"
        ),
        errors_24h: scalar!(
            pg,
            "SELECT COUNT(*) FROM audit_log WHERE status >= 500 AND ts > NOW() - interval '24 hours'"
        ),
        flagged_sessions: scalar!(
            pg,
            "SELECT COUNT(*) FROM sessions WHERE flagged_at IS NOT NULL AND revoked_at IS NULL"
        ),
        pending_mod_posts: scalar!(
            pg,
            "SELECT COUNT(*) FROM posts WHERE moderation_state = 'quarantine' AND deleted_at IS NULL"
        ),
        dm_messages_24h: scalar!(
            pg,
            "SELECT COUNT(*) FROM dm_messages WHERE created_at > NOW() - interval '24 hours'"
        ),
        media_total: scalar!(pg, "SELECT COUNT(*) FROM media"),
        media_bytes: scalar!(pg, "SELECT COALESCE(SUM(size_bytes), 0) FROM media"),
    };
    Ok(Json(s))
}

// ── List posts ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct PostFilter {
    #[serde(default)]
    state: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    100
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminPostRow {
    id: Uuid,
    author_id: Uuid,
    author_username: String,
    body: String,
    visibility: String,
    moderation_state: String,
    spam_score: Option<i16>,
    reactions_count: i32,
    replies_count: i32,
    created_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
}

async fn list_posts(
    State(state): State<AppState>,
    _a: AdminUser,
    Query(q): Query<PostFilter>,
) -> Result<Json<Vec<AdminPostRow>>, AppError> {
    let limit = q.limit.clamp(1, 500);
    let state_filter = q.state.as_deref().unwrap_or("all");
    let rows: Vec<AdminPostRow> = sqlx::query_as(
        r#"
        SELECT
            p.id, p.author_id, u.username AS author_username,
            p.body, p.visibility, p.moderation_state, p.spam_score,
            p.reactions_count, p.replies_count, p.created_at, p.deleted_at
        FROM posts p JOIN users u ON u.id = p.author_id
        WHERE ($1 = 'all' OR p.moderation_state = $1)
        ORDER BY p.created_at DESC
        LIMIT $2
        "#,
    )
    .bind(state_filter)
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ── PATCH post mod state ────────────────────────────────────────

#[derive(Deserialize)]
pub struct PatchPost {
    moderation_state: String,
    #[serde(default)]
    reason: Option<String>,
    /// On removal, also blocklist the post's image hashes so they can't be
    /// re-uploaded (P5). Opt-in, since the removal may be unrelated to the image.
    #[serde(default)]
    block_media: Option<bool>,
}

async fn patch_post(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(input): Json<PatchPost>,
) -> Result<StatusCode, AppError> {
    if !matches!(
        input.moderation_state.as_str(),
        "live" | "quarantine" | "removed"
    ) {
        return Err(AppError::BadRequest("invalid state".into()));
    }
    let row: Option<(Uuid, String)> = sqlx::query_as(
        "UPDATE posts SET moderation_state = $1, updated_at = NOW() WHERE id = $2 RETURNING author_id, body",
    )
    .bind(&input.moderation_state)
    .bind(id)
    .fetch_optional(&state.pg)
    .await?;
    let Some((author_id, body)) = row else {
        return Err(AppError::NotFound);
    };
    // Sync search index: only public+live posts from active users surface anonymously.
    let search = state.search.clone();
    let pg = state.pg.clone();
    tokio::spawn(async move {
        sync_post_search(pg, search, id).await;
    });
    log_action(
        &state,
        "post",
        id,
        &format!("set_state:{}", input.moderation_state),
        Actor::Admin(admin.0.user_id),
        input.reason.as_deref(),
        None,
    )
    .await;
    // An admin's terminal decision settles the community flags that pointed at the
    // post: approving (live) dismisses them as no_action, removing upholds them.
    // This also stops the report-threshold auto-quarantine (reports.rs) from
    // re-firing on a post an admin just approved while its reports sat open. A
    // manual 'quarantine' is non-terminal, so its reports stay open for the queue.
    if matches!(input.moderation_state.as_str(), "live" | "removed") {
        let resolution = if input.moderation_state == "removed" {
            "removed"
        } else {
            "no_action"
        };
        let _ = sqlx::query(
            r#"
            UPDATE reports SET resolved_at = NOW(), resolved_by = $1, resolution = $2
            WHERE target_kind = 'post' AND target_id = $3 AND resolved_at IS NULL
            "#,
        )
        .bind(admin.0.user_id)
        .bind(resolution)
        .bind(id)
        .execute(&state.pg)
        .await;
    }
    // An admin removal is the strongest content signal — weight the author's heat
    // heavily so a few upheld removals escalate the account toward an autonomous
    // suspend (P2). Quarantine/live are not offenses (live exonerates).
    if input.moderation_state == "removed" {
        crate::moderation::register_content_offense(&state, author_id, &body, 5, "admin removal")
            .await;
        // Opt-in: blocklist this post's image hashes so the same image can't be
        // re-uploaded (P5). Idempotent; keyed on the re-encoded content hash.
        if input.block_media == Some(true) {
            let _ = sqlx::query(
                r#"
                INSERT INTO blocked_media_hashes (sha256, reason, blocked_by)
                SELECT m.sha256, $2, $3
                FROM media m JOIN post_media pm ON pm.media_id = m.id
                WHERE pm.post_id = $1
                ON CONFLICT (sha256) DO NOTHING
                "#,
            )
            .bind(id)
            .bind(input.reason.as_deref())
            .bind(admin.0.user_id)
            .execute(&state.pg)
            .await;
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── List users ──────────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminUserRow {
    id: Uuid,
    username: String,
    email: String,
    display_name: String,
    role: String,
    created_at: DateTime<Utc>,
    last_seen_at: Option<DateTime<Utc>>,
    post_count: i64,
}

async fn list_users(
    State(state): State<AppState>,
    _a: AdminUser,
) -> Result<Json<Vec<AdminUserRow>>, AppError> {
    let rows: Vec<AdminUserRow> = sqlx::query_as(
        r#"
        SELECT
            u.id, u.username, u.email::text AS email, u.display_name, u.role,
            u.created_at, u.last_seen_at,
            (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND deleted_at IS NULL)::bigint AS post_count
        FROM users u
        ORDER BY u.created_at DESC
        LIMIT 500
        "#,
    )
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ── PATCH user (suspend / unsuspend) ────────────────────────────

#[derive(Deserialize)]
pub struct PatchUser {
    role: String,
    #[serde(default)]
    reason: Option<String>,
}

async fn patch_user(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(input): Json<PatchUser>,
) -> Result<StatusCode, AppError> {
    // Admin role promotion is NOT exposed via API — only suspend/member toggle.
    if !matches!(input.role.as_str(), "suspended" | "member") {
        return Err(AppError::BadRequest(
            "role must be 'suspended' or 'member' (admin granted only via env)".into(),
        ));
    }
    if id == admin.0.user_id {
        return Err(AppError::BadRequest("cannot modify own role".into()));
    }
    let updated = sqlx::query(
        "UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND role <> 'admin'",
    )
    .bind(&input.role)
    .bind(id)
    .execute(&state.pg)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::NotFound);
    }
    // Suspending also revokes active sessions/API tokens and removes public posts
    // from search immediately. Unsuspend reindexes eligible public posts.
    let pg = state.pg.clone();
    let search = state.search.clone();
    let role = input.role.clone();
    if input.role == "suspended" {
        let _ = sqlx::query(
            "UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
        )
        .bind(id)
        .execute(&state.pg)
        .await;
        let _ = sqlx::query(
            "UPDATE api_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
        )
        .bind(id)
        .execute(&state.pg)
        .await;
    }
    tokio::spawn(async move {
        sync_user_search(pg, search, id, &role).await;
    });
    log_action(
        &state,
        "user",
        id,
        &format!("set_role:{}", input.role),
        Actor::Admin(admin.0.user_id),
        input.reason.as_deref(),
        None,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

// ── PATCH user shadow-ban (P4) ──────────────────────────────────

#[derive(Deserialize)]
pub struct PatchShadow {
    shadow_banned: bool,
    #[serde(default)]
    reason: Option<String>,
}

/// Manually shadow-ban (`shadow_banned: true`) or lift it (`false`) for a user.
/// The mechanism lives in `crate::moderation`; this is the admin surface beside
/// the autonomous heat-driven path, logged with `actor_kind='admin'`.
async fn patch_user_shadow(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(input): Json<PatchShadow>,
) -> Result<StatusCode, AppError> {
    if id == admin.0.user_id {
        return Err(AppError::BadRequest("cannot shadow-ban yourself".into()));
    }
    let actor = Actor::Admin(admin.0.user_id);
    let reason = input.reason.as_deref().unwrap_or("admin action");
    if input.shadow_banned {
        crate::moderation::shadow_ban(&state, id, actor, reason).await;
    } else {
        crate::moderation::unshadow_ban(&state, id, actor, reason).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn sync_post_search(pg: sqlx::PgPool, search: Search, post_id: Uuid) {
    let row: Option<SearchPostRow> = sqlx::query_as(
        r#"
            SELECT p.author_id, u.username, p.body, p.visibility, p.moderation_state,
                   p.created_at, p.reactions_count, p.replies_count
            FROM posts p
            JOIN users u ON u.id = p.author_id
            WHERE p.id = $1
              AND p.deleted_at IS NULL
              AND u.role <> 'suspended'
            "#,
    )
    .bind(post_id)
    .fetch_optional(&pg)
    .await
    .ok()
    .flatten();

    let Some((author_id, username, body, visibility, moderation_state, created_at, rc, replies)) =
        row
    else {
        search.delete_post(post_id).await;
        return;
    };

    if visibility == "public" && moderation_state == "live" {
        let doc = PostDoc::from_parts(
            post_id,
            author_id,
            &username,
            &body,
            &visibility,
            &moderation_state,
            rc,
            replies,
            created_at,
        );
        search.index_post(&doc).await;
    } else {
        search.delete_post(post_id).await;
    }
}

pub(crate) async fn sync_user_search(pg: sqlx::PgPool, search: Search, user_id: Uuid, role: &str) {
    if role == "suspended" {
        let ids: Vec<Uuid> =
            sqlx::query_scalar("SELECT id FROM posts WHERE author_id = $1 AND deleted_at IS NULL")
                .bind(user_id)
                .fetch_all(&pg)
                .await
                .unwrap_or_default();
        for id in ids {
            search.delete_post(id).await;
        }
        return;
    }

    let rows: Vec<(Uuid, String, String, DateTime<Utc>, i32, i32)> = sqlx::query_as(
        r#"
        SELECT p.id, u.username, p.body, p.created_at, p.reactions_count, p.replies_count
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.author_id = $1
          AND p.deleted_at IS NULL
          AND p.moderation_state = 'live'
          AND p.visibility = 'public'
          AND u.role <> 'suspended'
        "#,
    )
    .bind(user_id)
    .fetch_all(&pg)
    .await
    .unwrap_or_default();

    let docs: Vec<PostDoc> = rows
        .into_iter()
        .map(|(id, username, body, created_at, rc, replies)| {
            PostDoc::from_parts(
                id, user_id, &username, &body, "public", "live", rc, replies, created_at,
            )
        })
        .collect();
    search.index_many(&docs).await;
}

// ── Recent login_attempts ───────────────────────────────────────

#[derive(Deserialize)]
pub struct AttemptFilter {
    outcome: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct LoginAttemptRow {
    email: Option<String>,
    kind: String,
    outcome: String,
    ip: Option<String>,
    user_agent: Option<String>,
    ts: DateTime<Utc>,
}

async fn login_attempts(
    State(state): State<AppState>,
    _a: AdminUser,
    Query(q): Query<AttemptFilter>,
) -> Result<Json<Vec<LoginAttemptRow>>, AppError> {
    let limit = q.limit.clamp(1, 500);
    let rows: Vec<LoginAttemptRow> = sqlx::query_as(
        r#"
        SELECT email::text, kind, outcome, host(ip)::text AS ip, user_agent, ts
        FROM login_attempts
        WHERE ($1::text IS NULL OR outcome = $1)
        ORDER BY ts DESC
        LIMIT $2
        "#,
    )
    .bind(q.outcome.as_deref())
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ── Audit log (error responses by default) ──────────────────────

#[derive(Deserialize)]
pub struct AuditFilter {
    #[serde(default)]
    status_min: Option<i16>,
    #[serde(default = "default_limit")]
    limit: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AuditRow {
    id: Uuid,
    method: String,
    path: String,
    status: i16,
    latency_ms: i32,
    ip: Option<String>,
    user_agent: Option<String>,
    user_id: Option<Uuid>,
    ts: DateTime<Utc>,
}

async fn audit(
    State(state): State<AppState>,
    _a: AdminUser,
    Query(q): Query<AuditFilter>,
) -> Result<Json<Vec<AuditRow>>, AppError> {
    let limit = q.limit.clamp(1, 500);
    let min = q.status_min.unwrap_or(0);
    let rows: Vec<AuditRow> = sqlx::query_as(
        r#"
        SELECT id, method, path, status, latency_ms,
               host(ip)::text AS ip, user_agent, user_id, ts
        FROM audit_log
        WHERE status >= $1
        ORDER BY ts DESC
        LIMIT $2
        "#,
    )
    .bind(min)
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ── Flagged sessions ────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
pub struct SessionRow {
    id: Uuid,
    user_id: Uuid,
    username: String,
    ip: Option<String>,
    user_agent: Option<String>,
    last_seen_ip: Option<String>,
    last_seen_ua: Option<String>,
    last_seen_at: DateTime<Utc>,
    flagged_at: Option<DateTime<Utc>>,
    expires_at: DateTime<Utc>,
    revoked_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
pub struct SessionFilter {
    #[serde(default)]
    flagged: Option<u8>,
}

async fn sessions(
    State(state): State<AppState>,
    _a: AdminUser,
    Query(q): Query<SessionFilter>,
) -> Result<Json<Vec<SessionRow>>, AppError> {
    let only_flagged = matches!(q.flagged, Some(1));
    let rows: Vec<SessionRow> = sqlx::query_as(
        r#"
        SELECT
            s.id, s.user_id, u.username,
            host(s.ip)::text AS ip,
            s.user_agent,
            host(s.last_seen_ip)::text AS last_seen_ip,
            s.last_seen_ua,
            s.last_seen_at,
            s.flagged_at,
            s.expires_at,
            s.revoked_at
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE ($1 = false OR s.flagged_at IS NOT NULL)
        ORDER BY COALESCE(s.flagged_at, s.last_seen_at) DESC
        LIMIT 200
        "#,
    )
    .bind(only_flagged)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ── Moderation log ──────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
pub struct ModLogRow {
    id: Uuid,
    target_kind: String,
    target_id: Uuid,
    action: String,
    actor_kind: String,
    actor_id: Option<Uuid>,
    reason: Option<String>,
    ai_score: Option<i16>,
    created_at: DateTime<Utc>,
}

async fn mod_log(
    State(state): State<AppState>,
    _a: AdminUser,
) -> Result<Json<Vec<ModLogRow>>, AppError> {
    let rows: Vec<ModLogRow> = sqlx::query_as(
        r#"
        SELECT id, target_kind, target_id, action, actor_kind, actor_id, reason, ai_score, created_at
        FROM moderation_log
        ORDER BY created_at DESC
        LIMIT 200
        "#,
    )
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// The moderation_log writer lives in `crate::moderation` (`log_action` + `Actor`)
// so the post pipeline can record automated (`Actor::Ai`) decisions through the
// same path; the admin routes above log human actions via `Actor::Admin`.
