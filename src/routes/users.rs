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
        .route("/me", patch(patch_me))
        .route("/{username}", get(get_profile))
        .route("/{username}/posts", get(user_posts))
        .route("/{username}/followers", get(followers))
        .route("/{username}/following", get(following))
        .route("/{username}/follow", post(follow).delete(unfollow))
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
    let row: Option<(Uuid, String, String, Option<String>, Option<String>, String, DateTime<Utc>, Option<DateTime<Utc>>)> =
        sqlx::query_as(
            r#"
            SELECT id, username, display_name, bio, avatar_url, role, created_at, last_seen_at
            FROM users
            WHERE username = $1
            "#,
        )
        .bind(&username)
        .fetch_optional(&state.pg)
        .await?;

    let (id, username, display_name, bio, avatar_url, role, created_at, last_seen_at) =
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
