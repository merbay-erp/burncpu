// /api/v1/users — profiles + follow graph.
//
//   GET    /users/{username}            → profile view (public)
//   GET    /users/{username}/posts      → author's posts (public, paginated)
//   GET    /users/{username}/followers  → list of usernames following
//   GET    /users/{username}/following  → list of usernames being followed
//   POST   /users/{username}/follow     → follow (auth)
//   DELETE /users/{username}/follow     → unfollow (auth)
//   PATCH  /users/me                    → edit own profile (auth)

use crate::{
    errors::AppError,
    middleware::session::CurrentUser,
    routes::notifications::notify,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me", get(get_me).patch(patch_me).delete(delete_me))
        .route("/me/export", get(export_me))
        .route("/me/trash", get(trash))
        .route("/me/activity", get(activity))
        .route("/me/pin/{post_id}", post(pin_post).delete(unpin_post))
        .route("/{username}", get(get_profile))
        .route("/{username}/posts", get(user_posts))
        .route("/{username}/followers", get(followers))
        .route("/{username}/following", get(following))
        .route("/{username}/follow", post(follow).delete(unfollow))
        .route("/lookup", get(lookup_prefix))
}

// ─── GET /users/me/trash — soft-deleted posts within 30d ───────

#[derive(Serialize, sqlx::FromRow)]
pub struct TrashedPost {
    id: Uuid,
    body: String,
    deleted_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
}

async fn trash(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<Vec<TrashedPost>>, AppError> {
    let rows: Vec<TrashedPost> = sqlx::query_as(
        r#"
        SELECT id, body, deleted_at, created_at FROM posts
        WHERE author_id = $1
          AND deleted_at IS NOT NULL
          AND deleted_at > NOW() - interval '30 days'
        ORDER BY deleted_at DESC
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ─── GET /users/me/activity ?window=7d → per-day bucket counts ─

#[derive(Deserialize)]
pub struct ActivityQuery {
    #[serde(default = "default_activity_window")]
    window: String,
}
fn default_activity_window() -> String { "30d".to_string() }

#[derive(Serialize, sqlx::FromRow)]
pub struct ActivityBucket {
    day: DateTime<Utc>,
    posts: i64,
    reactions_received: i64,
    replies_received: i64,
    followers_gained: i64,
}

#[derive(Serialize)]
pub struct ActivityResponse {
    window: String,
    totals: ActivityTotals,
    daily: Vec<ActivityBucket>,
}

#[derive(Serialize)]
pub struct ActivityTotals {
    posts: i64,
    reactions_received: i64,
    replies_received: i64,
    followers_gained: i64,
}

async fn activity(
    State(state): State<AppState>,
    user: CurrentUser,
    Query(q): Query<ActivityQuery>,
) -> Result<Json<ActivityResponse>, AppError> {
    let days: i64 = match q.window.as_str() {
        "7d" => 7,
        "30d" => 30,
        "90d" => 90,
        _ => 30,
    };
    let rows: Vec<ActivityBucket> = sqlx::query_as(
        r#"
        WITH days AS (
            SELECT generate_series(
                date_trunc('day', NOW() - ($1 || ' days')::interval),
                date_trunc('day', NOW()),
                interval '1 day'
            ) AS day
        ),
        posts_per AS (
            SELECT date_trunc('day', created_at) AS day, COUNT(*)::bigint AS n
            FROM posts WHERE author_id = $2 AND deleted_at IS NULL
              AND created_at > NOW() - ($1 || ' days')::interval
            GROUP BY 1
        ),
        reactions_per AS (
            SELECT date_trunc('day', r.created_at) AS day, COUNT(*)::bigint AS n
            FROM reactions r JOIN posts p ON p.id = r.post_id
            WHERE p.author_id = $2
              AND r.created_at > NOW() - ($1 || ' days')::interval
            GROUP BY 1
        ),
        replies_per AS (
            SELECT date_trunc('day', child.created_at) AS day, COUNT(*)::bigint AS n
            FROM posts child JOIN posts parent ON parent.id = child.reply_to_id
            WHERE parent.author_id = $2
              AND child.author_id <> $2
              AND child.created_at > NOW() - ($1 || ' days')::interval
            GROUP BY 1
        ),
        follows_per AS (
            SELECT date_trunc('day', created_at) AS day, COUNT(*)::bigint AS n
            FROM follows
            WHERE followee_id = $2
              AND created_at > NOW() - ($1 || ' days')::interval
            GROUP BY 1
        )
        SELECT
            d.day,
            COALESCE(p.n, 0)  AS posts,
            COALESCE(rx.n, 0) AS reactions_received,
            COALESCE(rp.n, 0) AS replies_received,
            COALESCE(f.n, 0)  AS followers_gained
        FROM days d
        LEFT JOIN posts_per p ON p.day = d.day
        LEFT JOIN reactions_per rx ON rx.day = d.day
        LEFT JOIN replies_per rp ON rp.day = d.day
        LEFT JOIN follows_per f ON f.day = d.day
        ORDER BY d.day ASC
        "#,
    )
    .bind(days.to_string())
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await?;

    let totals = rows.iter().fold(ActivityTotals {
        posts: 0, reactions_received: 0, replies_received: 0, followers_gained: 0,
    }, |mut acc, r| {
        acc.posts += r.posts;
        acc.reactions_received += r.reactions_received;
        acc.replies_received += r.replies_received;
        acc.followers_gained += r.followers_gained;
        acc
    });

    Ok(Json(ActivityResponse {
        window: q.window,
        totals,
        daily: rows,
    }))
}

#[derive(Deserialize)]
pub struct LookupQuery {
    prefix: String,
    #[serde(default = "default_lookup_limit")]
    limit: i64,
}
fn default_lookup_limit() -> i64 { 8 }

async fn lookup_prefix(
    State(state): State<AppState>,
    Query(q): Query<LookupQuery>,
) -> Result<Json<Vec<UserBrief>>, AppError> {
    let p = q.prefix.trim().to_lowercase();
    if p.is_empty() || p.len() > 32 {
        return Ok(Json(vec![]));
    }
    let limit = q.limit.clamp(1, 20);
    let pattern = format!("{}%", p);
    let rows: Vec<UserBrief> = sqlx::query_as(
        r#"
        SELECT id, username, display_name, avatar_url
        FROM users
        WHERE username LIKE $1 AND role <> 'suspended'
        ORDER BY (CASE WHEN username = $2 THEN 0 ELSE 1 END), username ASC
        LIMIT $3
        "#,
    )
    .bind(&pattern)
    .bind(&p)
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ─── Pinned post ────────────────────────────────────────────────

async fn pin_post(
    State(state): State<AppState>,
    user: CurrentUser,
    axum::extract::Path(post_id): axum::extract::Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let owner: Option<Uuid> = sqlx::query_scalar(
        "SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL AND moderation_state = 'live' AND visibility = 'public'",
    )
    .bind(post_id)
    .fetch_optional(&state.pg)
    .await?;
    let owner = owner.ok_or(AppError::NotFound)?;
    if owner != user.user_id {
        return Err(AppError::Forbidden);
    }
    sqlx::query("UPDATE users SET pinned_post_id = $1 WHERE id = $2")
        .bind(post_id)
        .bind(user.user_id)
        .execute(&state.pg)
        .await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn unpin_post(
    State(state): State<AppState>,
    user: CurrentUser,
    axum::extract::Path(_post_id): axum::extract::Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    sqlx::query("UPDATE users SET pinned_post_id = NULL WHERE id = $1")
        .bind(user.user_id)
        .execute(&state.pg)
        .await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ─── Account export ─────────────────────────────────────────────

async fn export_me(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<axum::response::Response, AppError> {
    use axum::http::header;
    let profile: serde_json::Value = sqlx::query_scalar(
        "SELECT row_to_json(u) FROM users u WHERE id = $1",
    )
    .bind(user.user_id)
    .fetch_one(&state.pg)
    .await?;
    let posts: Vec<serde_json::Value> = sqlx::query_scalar(
        r#"SELECT row_to_json(p) FROM posts p WHERE author_id = $1 ORDER BY created_at DESC"#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();
    let follows: Vec<serde_json::Value> = sqlx::query_scalar(
        r#"
        SELECT json_build_object('followee', u.username, 'since', f.created_at)
        FROM follows f JOIN users u ON u.id = f.followee_id
        WHERE f.follower_id = $1
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();
    let reactions: Vec<serde_json::Value> = sqlx::query_scalar(
        r#"
        SELECT json_build_object('post_id', post_id, 'emoji', emoji, 'at', created_at)
        FROM reactions WHERE user_id = $1 ORDER BY created_at DESC
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();
    let bookmarks: Vec<serde_json::Value> = sqlx::query_scalar(
        r#"
        SELECT json_build_object('post_id', post_id, 'at', created_at)
        FROM bookmarks WHERE user_id = $1 ORDER BY created_at DESC
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();
    let media_list: Vec<serde_json::Value> = sqlx::query_scalar(
        r#"
        SELECT json_build_object('url', '/media/' || filename, 'mime', mime_type, 'bytes', size_bytes, 'at', created_at)
        FROM media WHERE owner_id = $1 ORDER BY created_at DESC
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await
    .unwrap_or_default();

    let payload = serde_json::json!({
        "exported_at": Utc::now(),
        "profile": profile,
        "posts": posts,
        "follows": follows,
        "reactions": reactions,
        "bookmarks": bookmarks,
        "media": media_list,
    });
    let json = serde_json::to_vec_pretty(&payload)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    let mut h = axum::http::HeaderMap::new();
    h.insert(header::CONTENT_TYPE, axum::http::HeaderValue::from_static("application/json"));
    h.insert(
        header::CONTENT_DISPOSITION,
        axum::http::HeaderValue::from_str(&format!(
            "attachment; filename=\"burncpu-export-{}.json\"",
            Utc::now().format("%Y-%m-%d")
        ))
        .unwrap(),
    );
    use axum::response::IntoResponse;
    Ok((axum::http::StatusCode::OK, h, json).into_response())
}

/// DELETE /users/me — cascading account wipe.
///
/// Requires a confirmation header `X-Confirm-Username` matching the
/// caller's username so a stray DELETE can't nuke an account. All
/// owned rows (posts, sessions, follows, reactions, bookmarks, invites,
/// media, totp, notifications) cascade-delete via FK ON DELETE CASCADE.
async fn delete_me(
    State(state): State<AppState>,
    user: CurrentUser,
    headers: axum::http::HeaderMap,
) -> Result<axum::http::StatusCode, AppError> {
    let username: String =
        sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
            .bind(user.user_id)
            .fetch_one(&state.pg)
            .await?;
    let confirm = headers
        .get("x-confirm-username")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim();
    if confirm != username {
        return Err(AppError::BadRequest(
            "X-Confirm-Username header must equal your username".into(),
        ));
    }
    if user.role == "admin" {
        // Admin self-deletion would leave the platform headless. Block it.
        return Err(AppError::Forbidden);
    }
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user.user_id)
        .execute(&state.pg)
        .await?;
    tracing::warn!(user_id = %user.user_id, %username, "account deleted by owner");
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
pub struct Me {
    user_id: Uuid,
    username: String,
    display_name: String,
    role: String,
    pending_2fa: bool,
    session_flagged: bool,
}

async fn get_me(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<Me>, AppError> {
    let row: (String, String) =
        sqlx::query_as("SELECT username, display_name FROM users WHERE id = $1")
            .bind(user.user_id)
            .fetch_one(&state.pg)
            .await?;
    Ok(Json(Me {
        user_id: user.user_id,
        username: row.0,
        display_name: row.1,
        role: user.role,
        pending_2fa: user.pending_2fa,
        session_flagged: user.session_flagged,
    }))
}

// ── Profile ─────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct Profile {
    id: Uuid,
    username: String,
    display_name: String,
    bio: Option<String>,
    avatar_url: Option<String>,
    role: String,
    created_at: DateTime<Utc>,
    last_seen_at: Option<DateTime<Utc>>,
    pinned_post_id: Option<Uuid>,
    counts: ProfileCounts,
}

#[derive(Serialize)]
pub struct ProfileCounts {
    posts: i64,
    followers: i64,
    following: i64,
}

async fn get_profile(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<Json<Profile>, AppError> {
    let row: Option<(Uuid, String, String, Option<String>, Option<String>, String, DateTime<Utc>, Option<DateTime<Utc>>, Option<Uuid>)> =
        sqlx::query_as(
            r#"
            SELECT id, username, display_name, bio, avatar_url, role, created_at, last_seen_at, pinned_post_id
            FROM users
            WHERE username = $1
            "#,
        )
        .bind(&username)
        .fetch_optional(&state.pg)
        .await?;

    let (id, username, display_name, bio, avatar_url, role, created_at, last_seen_at, pinned_post_id) =
        row.ok_or(AppError::NotFound)?;

    let posts: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM posts
        WHERE author_id = $1 AND deleted_at IS NULL
          AND moderation_state = 'live' AND visibility = 'public'
        "#,
    )
    .bind(id)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(0);

    let followers: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM follows WHERE followee_id = $1")
            .bind(id)
            .fetch_one(&state.pg)
            .await
            .unwrap_or(0);

    let following: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM follows WHERE follower_id = $1")
            .bind(id)
            .fetch_one(&state.pg)
            .await
            .unwrap_or(0);

    Ok(Json(Profile {
        id,
        username,
        display_name,
        bio,
        avatar_url,
        role,
        created_at,
        last_seen_at,
        pinned_post_id,
        counts: ProfileCounts { posts, followers, following },
    }))
}

// ── Author posts ────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct PageQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    before: Option<DateTime<Utc>>,
}

fn default_limit() -> i64 {
    50
}

#[derive(Serialize, sqlx::FromRow)]
pub struct PostBrief {
    id: Uuid,
    body: String,
    body_html: String,
    reactions_count: i32,
    replies_count: i32,
    created_at: DateTime<Utc>,
}

async fn user_posts(
    State(state): State<AppState>,
    Path(username): Path<String>,
    Query(q): Query<PageQuery>,
) -> Result<Json<Vec<PostBrief>>, AppError> {
    let user_id: Option<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&username)
        .fetch_optional(&state.pg)
        .await?;
    let user_id = user_id.ok_or(AppError::NotFound)?;
    let limit = q.limit.clamp(1, 100);
    let before = q.before.unwrap_or_else(Utc::now);

    let rows: Vec<PostBrief> = sqlx::query_as(
        r#"
        SELECT id, body, body_html, reactions_count, replies_count, created_at
        FROM posts
        WHERE author_id = $1
          AND deleted_at IS NULL
          AND moderation_state = 'live'
          AND visibility = 'public'
          AND created_at < $2
        ORDER BY created_at DESC
        LIMIT $3
        "#,
    )
    .bind(user_id)
    .bind(before)
    .bind(limit)
    .fetch_all(&state.pg)
    .await?;

    Ok(Json(rows))
}

// ── Followers / following ───────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
pub struct UserBrief {
    id: Uuid,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
}

async fn followers(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<Json<Vec<UserBrief>>, AppError> {
    let user_id: Option<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&username)
        .fetch_optional(&state.pg)
        .await?;
    let user_id = user_id.ok_or(AppError::NotFound)?;
    let rows: Vec<UserBrief> = sqlx::query_as(
        r#"
        SELECT u.id, u.username, u.display_name, u.avatar_url
        FROM follows f
        JOIN users u ON u.id = f.follower_id
        WHERE f.followee_id = $1
        ORDER BY f.created_at DESC
        LIMIT 500
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

async fn following(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> Result<Json<Vec<UserBrief>>, AppError> {
    let user_id: Option<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&username)
        .fetch_optional(&state.pg)
        .await?;
    let user_id = user_id.ok_or(AppError::NotFound)?;
    let rows: Vec<UserBrief> = sqlx::query_as(
        r#"
        SELECT u.id, u.username, u.display_name, u.avatar_url
        FROM follows f
        JOIN users u ON u.id = f.followee_id
        WHERE f.follower_id = $1
        ORDER BY f.created_at DESC
        LIMIT 500
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

// ── Follow / unfollow ───────────────────────────────────────────

async fn follow(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(username): Path<String>,
) -> Result<StatusCode, AppError> {
    let target: Option<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&username)
        .fetch_optional(&state.pg)
        .await?;
    let target = target.ok_or(AppError::NotFound)?;
    if target == user.user_id {
        return Err(AppError::BadRequest("cannot follow yourself".into()));
    }

    let inserted = sqlx::query(
        r#"
        INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(user.user_id)
    .bind(target)
    .execute(&state.pg)
    .await?
    .rows_affected();

    // Notify only on the first follow (idempotent — duplicate POST is a no-op)
    if inserted > 0 {
        notify(&state, target, Some(user.user_id), "follow", "user", target, None).await;
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn unfollow(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(username): Path<String>,
) -> Result<StatusCode, AppError> {
    let target: Option<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
        .bind(&username)
        .fetch_optional(&state.pg)
        .await?;
    let target = target.ok_or(AppError::NotFound)?;

    sqlx::query("DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2")
        .bind(user.user_id)
        .bind(target)
        .execute(&state.pg)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ── PATCH /users/me ─────────────────────────────────────────────

#[derive(Deserialize)]
pub struct PatchMe {
    display_name: Option<String>,
    bio: Option<String>,
    avatar_url: Option<String>,
}

async fn patch_me(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(input): Json<PatchMe>,
) -> Result<Json<Profile>, AppError> {
    if let Some(n) = &input.display_name {
        let n = n.trim();
        if n.is_empty() || n.chars().count() > 80 {
            return Err(AppError::BadRequest("display_name must be 1..=80 chars".into()));
        }
    }
    if let Some(b) = &input.bio {
        if b.chars().count() > 280 {
            return Err(AppError::BadRequest("bio max 280 chars".into()));
        }
    }
    if let Some(a) = &input.avatar_url {
        if !(a.starts_with("https://") || a.is_empty()) {
            return Err(AppError::BadRequest("avatar_url must be https://".into()));
        }
    }

    sqlx::query(
        r#"
        UPDATE users SET
            display_name = COALESCE(NULLIF($2, ''), display_name),
            bio          = COALESCE($3, bio),
            avatar_url   = COALESCE($4, avatar_url),
            updated_at   = NOW()
        WHERE id = $1
        "#,
    )
    .bind(user.user_id)
    .bind(input.display_name.as_deref().map(str::trim).unwrap_or(""))
    .bind(input.bio.as_deref())
    .bind(input.avatar_url.as_deref())
    .execute(&state.pg)
    .await?;

    // Return the freshly updated profile by looking up username
    let username: String =
        sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
            .bind(user.user_id)
            .fetch_one(&state.pg)
            .await?;
    get_profile(State(state), Path(username)).await
}
