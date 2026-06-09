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
