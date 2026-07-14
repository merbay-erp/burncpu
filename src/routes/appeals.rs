// /api/v1/appeals — an author's recourse against moderation decisions on their posts.
//
//   POST   /appeals { post_id, note? }        → 201  (appeal own quarantined/removed post)
//   GET    /appeals/eligible                   → own posts currently appealable
//   GET    /admin/appeals ?open=1              → queue (admin)
//   PATCH  /admin/appeals/{id} { decision }    → grant (restore) / deny (admin)
//
// Appeals are the human counterweight to autonomous moderation: granting one
// restores the post to 'live' and reindexes it; every decision is recorded in
// moderation_log via crate::moderation, beside the automated and admin actions.

use crate::{
    errors::AppError,
    middleware::{auth_extractor::AdminUser, client_ip, session::CurrentUser},
    moderation::{Actor, log_action},
    routes::admin::{sync_post_search, sync_user_search},
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, patch, post},
};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use std::net::SocketAddr;
use uuid::Uuid;

// Per-author appeal rate limit (anti-spam).
const APPEAL_RATE_LIMIT_MAX: u32 = 20;
const APPEAL_RATE_LIMIT_WINDOW_SECS: u64 = 3600;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(create))
        .route("/eligible", get(eligible))
        // Unauthenticated: a suspended user can't log in to use the in-app flow.
        .route("/account", post(create_account))
}

pub fn admin_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/{id}", patch(resolve))
}

#[derive(Deserialize)]
pub struct AccountAppealBody {
    email: String,
    note: Option<String>,
}

/// Out-of-band account-suspension appeal. Unauthenticated and identified by email
/// (a suspended user can't authenticate). Enumeration-safe: it always returns 202,
/// and an appeal + confirmation email happen only when the email maps to a
/// suspended account — so the response never reveals whether an address exists or
/// is suspended. IP rate-limited; one open account appeal per user.
async fn create_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(b): Json<AccountAppealBody>,
) -> Result<StatusCode, AppError> {
    let ip = client_ip::extract(&headers, Some(&peer))
        .map(|i| i.to_string())
        .unwrap_or_else(|| "unknown".into());
    {
        let mut redis = state.redis.clone();
        let key = format!("rl:appeal:account:{ip}");
        let count = crate::ratelimit::hit(&mut redis, &key, 3600).await;
        if count > 5 {
            return Err(AppError::RateLimited);
        }
    }

    let email = b.email.trim().to_lowercase();
    let appellant: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM users WHERE email = $1 AND role = 'suspended'")
            .bind(&email)
            .fetch_optional(&state.pg)
            .await?;

    if let Some(uid) = appellant {
        let note = b
            .note
            .as_deref()
            .map(|s| s.trim().chars().take(1000).collect::<String>())
            .filter(|s| !s.is_empty());
        let inserted = sqlx::query(
            r#"
            INSERT INTO appeals (appellant_id, target_kind, note)
            VALUES ($1, 'account', $2)
            ON CONFLICT (appellant_id) WHERE status = 'open' AND target_kind = 'account'
            DO NOTHING
            "#,
        )
        .bind(uid)
        .bind(note)
        .execute(&state.pg)
        .await?
        .rows_affected();

        if inserted > 0
            && let Ok(sender) = crate::auth::email::Sender::from_env(&state.config.site_origin)
        {
            let _ = sender
                .send(
                    &email,
                    "burncpu.com — itiraz alındı",
                    "İtirazını aldık. Bir yönetici hesabını gözden geçirecek; sonucu \
                     giriş yapmayı deneyerek görebilirsin.\n\n🐢 burncpu",
                )
                .await;
        }
    }

    Ok(StatusCode::ACCEPTED)
}

#[derive(Deserialize)]
pub struct CreateBody {
    post_id: Uuid,
    note: Option<String>,
}

async fn create(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(b): Json<CreateBody>,
) -> Result<StatusCode, AppError> {
    // Only the author may appeal, and only a post actually under a moderation
    // action (quarantine/removed). A 'live' post has nothing to appeal, and
    // 'shadow' is invisible to the author by design. A non-owner is told NotFound
    // (don't leak that someone else's post exists).
    let row: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT author_id, moderation_state FROM posts WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(b.post_id)
    .fetch_optional(&state.pg)
    .await?;
    let Some((author_id, mod_state)) = row else {
        return Err(AppError::NotFound);
    };
    if author_id != user.user_id {
        return Err(AppError::NotFound);
    }
    if !matches!(mod_state.as_str(), "quarantine" | "removed") {
        return Err(AppError::BadRequest(
            "post is not under an appeal-eligible moderation action".into(),
        ));
    }

    // Per-author rate limit (appeal-spam guard).
    {
        let mut redis = state.redis.clone();
        let key = format!("rl:appeal:create:{}", user.user_id);
        let count =
            crate::ratelimit::hit(&mut redis, &key, APPEAL_RATE_LIMIT_WINDOW_SECS as i64).await;
        if count > APPEAL_RATE_LIMIT_MAX {
            return Err(AppError::RateLimited);
        }
    }

    let note = b
        .note
        .as_deref()
        .map(|s| s.trim().chars().take(1000).collect::<String>())
        .filter(|s| !s.is_empty());

    // Dedupe: one open appeal per (appellant, post); a repeat is an idempotent
    // no-op (appeals_dedupe_idx backs the ON CONFLICT).
    sqlx::query(
        r#"
        INSERT INTO appeals (appellant_id, post_id, note)
        VALUES ($1, $2, $3)
        ON CONFLICT (appellant_id, post_id) WHERE status = 'open'
        DO NOTHING
        "#,
    )
    .bind(user.user_id)
    .bind(b.post_id)
    .bind(note)
    .execute(&state.pg)
    .await?;
    Ok(StatusCode::CREATED)
}

#[derive(Serialize, sqlx::FromRow)]
pub struct EligiblePost {
    id: Uuid,
    body: String,
    moderation_state: String,
    created_at: DateTime<Utc>,
    has_open_appeal: bool,
}

async fn eligible(
    State(state): State<AppState>,
    user: CurrentUser,
) -> Result<Json<Vec<EligiblePost>>, AppError> {
    // The author's own posts under an appeal-eligible moderation action — an
    // author-only window onto their otherwise-hidden moderated content, each
    // flagged with whether an open appeal already exists.
    let rows: Vec<EligiblePost> = sqlx::query_as(
        r#"
        SELECT p.id, p.body, p.moderation_state, p.created_at,
               EXISTS(
                   SELECT 1 FROM appeals a
                   WHERE a.post_id = p.id AND a.appellant_id = $1 AND a.status = 'open'
               ) AS has_open_appeal
        FROM posts p
        WHERE p.author_id = $1
          AND p.deleted_at IS NULL
          AND p.moderation_state IN ('quarantine', 'removed')
        ORDER BY p.created_at DESC
        LIMIT 100
        "#,
    )
    .bind(user.user_id)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    open: Option<u8>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AppealRow {
    id: Uuid,
    target_kind: String,
    appellant_username: String,
    post_id: Option<Uuid>,
    post_body: Option<String>,
    post_state: Option<String>,
    note: Option<String>,
    status: String,
    created_at: DateTime<Utc>,
    resolved_at: Option<DateTime<Utc>>,
    resolved_by_username: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    _a: AdminUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<AppealRow>>, AppError> {
    let only_open = matches!(q.open, Some(1));
    let rows: Vec<AppealRow> = sqlx::query_as(
        r#"
        SELECT
            a.id, a.target_kind, au.username AS appellant_username, a.post_id,
            p.body AS post_body, p.moderation_state AS post_state,
            a.note, a.status, a.created_at, a.resolved_at,
            ru.username AS resolved_by_username
        FROM appeals a
        JOIN users au ON au.id = a.appellant_id
        LEFT JOIN posts p ON p.id = a.post_id
        LEFT JOIN users ru ON ru.id = a.resolved_by
        WHERE ($1 = false OR a.status = 'open')
        ORDER BY a.created_at DESC
        LIMIT 200
        "#,
    )
    .bind(only_open)
    .fetch_all(&state.pg)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct ResolveBody {
    decision: String,
}

async fn resolve(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(b): Json<ResolveBody>,
) -> Result<StatusCode, AppError> {
    let grant = match b.decision.as_str() {
        "grant" => true,
        "deny" => false,
        _ => {
            return Err(AppError::BadRequest(
                "decision must be 'grant' or 'deny'".into(),
            ));
        }
    };
    // Close the appeal (only if still open) and learn what it concerned.
    let row: Option<(String, Option<Uuid>, Uuid)> = sqlx::query_as(
        r#"
        UPDATE appeals
        SET status = $2, resolved_at = NOW(), resolved_by = $3
        WHERE id = $1 AND status = 'open'
        RETURNING target_kind, post_id, appellant_id
        "#,
    )
    .bind(id)
    .bind(if grant { "granted" } else { "denied" })
    .bind(admin.0.user_id)
    .fetch_optional(&state.pg)
    .await?;
    let Some((target_kind, post_id, appellant_id)) = row else {
        return Err(AppError::NotFound); // unknown or already resolved
    };

    let actor = Actor::Admin(admin.0.user_id);
    let decision = if grant {
        "appeal_granted"
    } else {
        "appeal_denied"
    };

    // Account appeal — granting lifts the suspension and re-indexes the account.
    if target_kind == "account" {
        if grant {
            let restored = sqlx::query(
                "UPDATE users SET role = 'member', updated_at = NOW() WHERE id = $1 AND role = 'suspended'",
            )
            .bind(appellant_id)
            .execute(&state.pg)
            .await
            .map(|r| r.rows_affected())
            .unwrap_or(0);
            if restored > 0 {
                let pg = state.pg.clone();
                let search = state.search.clone();
                tokio::spawn(async move {
                    sync_user_search(pg, search, appellant_id, "member").await;
                });
            }
        }
        log_action(&state, "user", appellant_id, decision, actor, None, None).await;
        return Ok(StatusCode::NO_CONTENT);
    }

    // Post appeal — post_id is guaranteed present by the appeals_target_ck constraint.
    let Some(post_id) = post_id else {
        return Ok(StatusCode::NO_CONTENT);
    };
    if grant {
        // Restore the post to live (if still moderated), reindex it, and clear the
        // community flags that pointed at it — mirrors admin patch_post → live.
        let restored = sqlx::query(
            "UPDATE posts SET moderation_state = 'live', updated_at = NOW() \
             WHERE id = $1 AND moderation_state IN ('quarantine', 'removed', 'shadow')",
        )
        .bind(post_id)
        .execute(&state.pg)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0);
        if restored > 0 {
            let pg = state.pg.clone();
            let search = state.search.clone();
            tokio::spawn(async move {
                sync_post_search(pg, search, post_id).await;
            });
            let _ = sqlx::query(
                "UPDATE reports SET resolved_at = NOW(), resolved_by = $1, resolution = 'no_action' \
                 WHERE target_kind = 'post' AND target_id = $2 AND resolved_at IS NULL",
            )
            .bind(admin.0.user_id)
            .bind(post_id)
            .execute(&state.pg)
            .await;
        }
    }
    log_action(&state, "post", post_id, decision, actor, None, None).await;
    Ok(StatusCode::NO_CONTENT)
}
