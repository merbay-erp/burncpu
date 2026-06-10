// /api/v1/reports — moderation reports queue.
//
//   POST   /reports  { target_kind, target_id, reason, note? }  → 201
//   GET    /admin/reports ?open=1                                → list (admin)
//   PATCH  /admin/reports/{id} { resolution }                    → mark resolved (admin)

use crate::{
    errors::AppError,
    middleware::{auth_extractor::AdminUser, session::CurrentUser},
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch, post},
};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

// Per-reporter throttle: dedupe stops same-target floods, this caps how many
// distinct targets one account can report per hour.
const REPORT_RATE_LIMIT_MAX: u32 = 30;
const REPORT_RATE_LIMIT_WINDOW_SECS: u64 = 3600;

pub fn router() -> Router<AppState> {
    Router::new().route("/", post(create))
}

pub fn admin_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/{id}", patch(resolve))
}

const REASONS: &[&str] = &["spam", "harassment", "illegal", "other"];
const RESOLUTIONS: &[&str] = &["no_action", "removed", "suspended", "other"];

#[derive(Deserialize)]
pub struct CreateBody {
    target_kind: String,
    target_id: Uuid,
    reason: String,
    note: Option<String>,
}

async fn create(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(b): Json<CreateBody>,
) -> Result<StatusCode, AppError> {
    if !matches!(b.target_kind.as_str(), "post" | "user" | "dm") {
        return Err(AppError::BadRequest("invalid target_kind".into()));
    }
    if !REASONS.contains(&b.reason.as_str()) {
        return Err(AppError::BadRequest(format!(
            "reason must be one of {}",
            REASONS.join(", ")
        )));
    }

    // Per-reporter rate limit (distinct-target floods).
    {
        let mut redis = state.redis.clone();
        let key = format!("rl:report:create:{}", user.user_id);
        let count =
            crate::ratelimit::hit(&mut redis, &key, REPORT_RATE_LIMIT_WINDOW_SECS as i64).await;
        if count > REPORT_RATE_LIMIT_MAX {
            return Err(AppError::RateLimited);
        }
    }

    // Dedupe: one open report per (reporter, target). A repeat is an
    // idempotent no-op (the reports_dedupe_idx partial unique index backs
    // the ON CONFLICT), so a buggy/abusive client can't multiply rows.
    let inserted = sqlx::query(
        r#"
        INSERT INTO reports (reporter_id, target_kind, target_id, reason, note)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (reporter_id, target_kind, target_id) WHERE resolved_at IS NULL
        DO NOTHING
        "#,
    )
    .bind(user.user_id)
    .bind(&b.target_kind)
    .bind(b.target_id)
    .bind(&b.reason)
    .bind(b.note.as_deref())
    .execute(&state.pg)
    .await?
    .rows_affected();

    // Reactive auto-moderation: once enough *distinct* accounts open a report
    // against a live post, quarantine it into the existing admin review queue
    // without waiting for a human. Gated on a genuinely new report (dedupe
    // no-ops must not re-trigger) and post targets only.
    if inserted > 0 && b.target_kind == "post" {
        maybe_quarantine_reported_post(&state, b.target_id).await;
    }

    Ok(StatusCode::CREATED)
}

/// Auto-quarantine a live post that has crossed the open-report threshold.
///
/// Strictly best-effort and self-contained: the report itself is already
/// committed, so any failure here is logged and swallowed rather than failing
/// the reporter's request. Safe to call on every new post report — it no-ops
/// unless the post is currently `live` and at/over the threshold.
///
/// Brigade resistance: staff-authored posts are exempt (a coordinated
/// false-report ring can't silence an admin/mod), the transition is gated to
/// fire exactly once (`live` → `quarantine`), and the destination is the
/// reversible review queue — never an irreversible removal. Reporter weighting
/// by reputation is a later layer (roadmap P3).
async fn maybe_quarantine_reported_post(state: &AppState, post_id: Uuid) {
    // Dedupe guarantees one open report per reporter, so this COUNT is the number
    // of distinct accounts that currently want the post gone.
    let open_reports: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM reports WHERE target_kind = 'post' AND target_id = $1 AND resolved_at IS NULL",
    )
    .bind(post_id)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(0);

    if open_reports < state.config.report_quarantine_threshold {
        return;
    }

    // Transition exactly once, skipping staff-authored posts. A NULL result means
    // it was already non-live (or staff) — nothing to do, and crucially no
    // duplicate log/search/heat churn on every further report past the threshold.
    let row: Option<(Uuid, String)> = sqlx::query_as(
        r#"
        UPDATE posts p SET moderation_state = 'quarantine', updated_at = NOW()
        WHERE p.id = $1 AND p.moderation_state = 'live'
          AND NOT EXISTS (
              SELECT 1 FROM users u WHERE u.id = p.author_id AND u.role IN ('admin', 'mod')
          )
        RETURNING p.author_id, p.body
        "#,
    )
    .bind(post_id)
    .fetch_optional(&state.pg)
    .await
    .ok()
    .flatten();

    let Some((author_id, body)) = row else {
        return;
    };

    // A previously-live post was indexed; drop it from search (only public+live
    // posts surface) off the request path, mirroring the admin patch_post flow.
    let pg = state.pg.clone();
    let search = state.search.clone();
    tokio::spawn(async move {
        crate::routes::admin::sync_post_search(pg, search, post_id).await;
    });

    // Record the automated decision in the same moderation_log the admin queue
    // reads, beside human actions — actor_kind='ai', score = the report count.
    crate::moderation::log_action(
        state,
        "post",
        post_id,
        "auto_quarantine",
        crate::moderation::Actor::Ai,
        Some(&format!("report threshold: {open_reports} open reports")),
        Some(i16::try_from(open_reports).unwrap_or(i16::MAX)),
    )
    .await;

    // Raise the author's heat + the linked domains' reputation; an account whose
    // posts keep getting community-quarantined escalates toward a suspend (P2/P3).
    crate::moderation::register_content_offense(
        state,
        author_id,
        &body,
        3,
        "report-threshold quarantine",
    )
    .await;

    tracing::info!(%post_id, reports = open_reports, "post auto-quarantined (report threshold)");
}

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    open: Option<u8>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ReportRow {
    id: Uuid,
    reporter_username: String,
    target_kind: String,
    target_id: Uuid,
    reason: String,
    note: Option<String>,
    created_at: DateTime<Utc>,
    resolved_at: Option<DateTime<Utc>>,
    resolved_by_username: Option<String>,
    resolution: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    _a: AdminUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<ReportRow>>, AppError> {
    let only_open = matches!(q.open, Some(1));
    let rows: Vec<ReportRow> = sqlx::query_as(
        r#"
        SELECT
            r.id, ru.username AS reporter_username, r.target_kind, r.target_id,
            r.reason, r.note, r.created_at, r.resolved_at,
            su.username AS resolved_by_username, r.resolution
        FROM reports r
        JOIN users ru ON ru.id = r.reporter_id
        LEFT JOIN users su ON su.id = r.resolved_by
        WHERE ($1 = false OR r.resolved_at IS NULL)
        ORDER BY r.created_at DESC
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
    resolution: String,
}

async fn resolve(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(b): Json<ResolveBody>,
) -> Result<StatusCode, AppError> {
    if !RESOLUTIONS.contains(&b.resolution.as_str()) {
        return Err(AppError::BadRequest("invalid resolution".into()));
    }
    let n = sqlx::query(
        r#"
        UPDATE reports SET resolved_at = NOW(), resolved_by = $1, resolution = $2
        WHERE id = $3 AND resolved_at IS NULL
        "#,
    )
    .bind(admin.0.user_id)
    .bind(&b.resolution)
    .bind(id)
    .execute(&state.pg)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}
