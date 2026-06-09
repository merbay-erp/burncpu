//! Shared moderation audit trail.
//!
//! Every moderation decision — whether taken by a human admin or by an automated
//! signal (the spam scorer, and later report thresholds / account heat) — writes
//! one append-only row to `moderation_log`. Keeping the writer here, rather than
//! private to the admin routes, lets the post pipeline record its *own* automated
//! actions through the same path and schema. The result is a single audit log
//! where AI and human decisions sit side by side, queryable the same way.
//!
//! Writes are strictly best-effort: the caller's primary action (quarantine,
//! approval, role change) has already committed by the time we log, so a logging
//! failure is warned and swallowed — it must never fail the request.

use crate::state::AppState;
use uuid::Uuid;

/// Who (or what) made a moderation decision. Maps onto the `moderation_log`
/// `actor_kind` CHECK constraint (`'ai' | 'admin' | 'system'`) plus the optional
/// `actor_id` FK — only a human admin carries an id.
#[derive(Clone, Copy)]
pub enum Actor {
    /// An automated signal (spam scorer, report threshold). No user id.
    Ai,
    /// A human admin/mod, identified by their user id.
    Admin(Uuid),
    /// The platform itself (cleanup jobs, cascades). No user id.
    #[allow(dead_code)] // wired as automated paths land (report thresholds, heat)
    System,
}

impl Actor {
    fn kind(self) -> &'static str {
        match self {
            Actor::Ai => "ai",
            Actor::Admin(_) => "admin",
            Actor::System => "system",
        }
    }

    fn id(self) -> Option<Uuid> {
        match self {
            Actor::Admin(id) => Some(id),
            Actor::Ai | Actor::System => None,
        }
    }
}

/// Append one row to `moderation_log`.
///
/// `ai_score` is the automated signal's score when an AI actor drove the
/// decision (`None` for human actions). Best-effort — see the module note.
pub async fn log_action(
    state: &AppState,
    target_kind: &str,
    target_id: Uuid,
    action: &str,
    actor: Actor,
    reason: Option<&str>,
    ai_score: Option<i16>,
) {
    let r = sqlx::query(
        r#"
        INSERT INTO moderation_log (target_kind, target_id, action, actor_kind, actor_id, reason, ai_score)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(target_kind)
    .bind(target_id)
    .bind(action)
    .bind(actor.kind())
    .bind(actor.id())
    .bind(reason)
    .bind(ai_score)
    .execute(&state.pg)
    .await;
    if let Err(e) = r {
        tracing::warn!(?e, action, "moderation_log insert failed");
    }
}

// ── Account heat & escalation (P2) ──────────────────────────────────────────
//
// "Heat" is a decaying per-account misbehaviour signal (see migration 0028):
// automated quarantines and upheld removals raise it; `current_heat()` decays it
// 1 pt/day. `register_content_offense` is the single entry point the content
// pipelines call — it raises heat and, past the configured threshold, escalates
// to an autonomous suspend.

/// Decay an account's heat to the present, add `points`, and return the new
/// score. One atomic UPDATE via `current_heat()`; returns 0 on any error — heat
/// is advisory and must never be a hard dependency of the calling action.
pub async fn add_heat(state: &AppState, user_id: Uuid, points: i32) -> i32 {
    sqlx::query_scalar(
        r#"
        UPDATE users
        SET heat_score = current_heat(heat_score, heat_updated_at) + $2,
            heat_updated_at = NOW()
        WHERE id = $1
        RETURNING heat_score
        "#,
    )
    .bind(user_id)
    .bind(points)
    .fetch_one(&state.pg)
    .await
    .unwrap_or(0)
}

/// Record an automated content offense: raise the author's heat by `points`,
/// penalize the reputation of every domain linked in `body` by the same amount,
/// and — if the heat reaches `HEAT_SUSPEND_THRESHOLD` (when configured > 0) —
/// auto-suspend the account. The single entry point every quarantine/removal path
/// calls, so author heat (P2) and domain reputation (P3) escalate together and
/// identically. Best-effort throughout.
pub async fn register_content_offense(
    state: &AppState,
    author_id: Uuid,
    body: &str,
    points: i32,
    reason: &str,
) {
    let heat = add_heat(state, author_id, points).await;
    penalize_domains(state, body, points).await;
    let threshold = state.config.heat_suspend_threshold;
    if threshold > 0 && heat >= threshold {
        auto_suspend(state, author_id, &format!("heat {heat} >= {threshold} ({reason})")).await;
    }
}

/// Add `points` of badness to every http(s) domain linked in `body` (decay-then-add
/// via current_heat, keyed by host). Driven by the same offense events as heat, so a
/// domain's reputation tracks the quarantines/removals of the posts it rode in on.
/// Best-effort; a no-op when the body carries no links.
async fn penalize_domains(state: &AppState, body: &str, points: i32) {
    let domains = crate::net_safety::extract_domains(body);
    if domains.is_empty() {
        return;
    }
    let _ = sqlx::query(
        r#"
        INSERT INTO link_reputation (domain, bad_score, updated_at)
        SELECT d, $2, NOW() FROM unnest($1::text[]) AS d
        ON CONFLICT (domain) DO UPDATE
        SET bad_score = current_heat(link_reputation.bad_score, link_reputation.updated_at) + $2,
            updated_at = NOW()
        "#,
    )
    .bind(&domains)
    .bind(points)
    .execute(&state.pg)
    .await;
}

/// Autonomously suspend an account (the hard escalation tier), mirroring the
/// manual admin suspend exactly: never touches an admin or an already-suspended
/// account, revokes live sessions and API tokens, pulls the account's posts from
/// search, and logs the decision as `actor_kind='ai'`. Reversible by an admin
/// (PATCH /admin/users/{id} → member). The role guard makes it fire at most once.
pub async fn auto_suspend(state: &AppState, user_id: Uuid, reason: &str) {
    let suspended = sqlx::query(
        "UPDATE users SET role = 'suspended', updated_at = NOW() \
         WHERE id = $1 AND role NOT IN ('admin', 'suspended')",
    )
    .bind(user_id)
    .execute(&state.pg)
    .await
    .map(|r| r.rows_affected())
    .unwrap_or(0);
    if suspended == 0 {
        return; // admin, already suspended, or gone — no-op (and no duplicate log)
    }
    let _ = sqlx::query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .execute(&state.pg)
        .await;
    let _ = sqlx::query("UPDATE api_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .execute(&state.pg)
        .await;
    // Pull their posts from search off the request path — only active users'
    // public posts are indexed (mirrors admin sync_user_search's suspend branch).
    let pg = state.pg.clone();
    let search = state.search.clone();
    tokio::spawn(async move {
        let ids: Vec<Uuid> =
            sqlx::query_scalar("SELECT id FROM posts WHERE author_id = $1 AND deleted_at IS NULL")
                .bind(user_id)
                .fetch_all(&pg)
                .await
                .unwrap_or_default();
        for id in ids {
            search.delete_post(id).await;
        }
    });
    log_action(state, "user", user_id, "auto_suspend", Actor::Ai, Some(reason), None).await;
    tracing::warn!(%user_id, reason, "account auto-suspended (heat threshold)");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actor_maps_to_check_constraint_values() {
        // These strings must match the moderation_log.actor_kind CHECK constraint
        // ('ai','admin','system') exactly — a typo is a runtime INSERT failure, not
        // a compile error, so pin them here.
        let admin = Uuid::nil();
        assert_eq!(Actor::Ai.kind(), "ai");
        assert_eq!(Actor::Admin(admin).kind(), "admin");
        assert_eq!(Actor::System.kind(), "system");

        // Only a human admin carries the actor_id FK; automated actors are null.
        assert_eq!(Actor::Ai.id(), None);
        assert_eq!(Actor::Admin(admin).id(), Some(admin));
        assert_eq!(Actor::System.id(), None);
    }
}
