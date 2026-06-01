// In-process scheduled cleanup. Avoids needing an external cron when a
// single Postgres bound by retention policies is enough.
//
// Cadence: every hour, on app boot offset by 60s so a crash-loop doesn't
// hammer the DB. Each query is independent; failures are logged and the
// rest of the pass continues.
//
// Retention:
//   - auth_tokens          : 1 day after expiry  (one-shot magic links)
//   - sessions             : expired OR revoked >30 days ago
//   - audit_log            : 90 days
//   - login_attempts       : 180 days (forensic window)
//   - notifications        : 180 days
//   - dm_messages (soft)   : 30 days after deleted_at
//   - invites (unredeemed) : 30 days after expiry
//
// All bounds documented as COMMENT ON TABLE in the schema.

use sqlx::PgPool;
use std::time::Duration;

const INTERVAL: Duration = Duration::from_secs(3600); // 1h
const INITIAL_DELAY: Duration = Duration::from_secs(60);

pub fn spawn(pg: PgPool) {
    tokio::spawn(async move {
        tokio::time::sleep(INITIAL_DELAY).await;
        let mut tick = tokio::time::interval(INTERVAL);
        // skip the immediate first tick (we already slept)
        tick.tick().await;
        loop {
            run_once(&pg).await;
            tick.tick().await;
        }
    });
}

async fn run_once(pg: &PgPool) {
    let started = std::time::Instant::now();
    let queries: &[(&str, &str)] = &[
        (
            "auth_tokens",
            "DELETE FROM auth_tokens WHERE expires_at < NOW() - interval '1 day'",
        ),
        (
            "sessions",
            "DELETE FROM sessions WHERE expires_at < NOW() OR (revoked_at IS NOT NULL AND revoked_at < NOW() - interval '30 days')",
        ),
        (
            "audit_log",
            "DELETE FROM audit_log WHERE ts < NOW() - interval '90 days'",
        ),
        (
            "login_attempts",
            "DELETE FROM login_attempts WHERE ts < NOW() - interval '180 days'",
        ),
        (
            "notifications",
            "DELETE FROM notifications WHERE created_at < NOW() - interval '180 days'",
        ),
        (
            "dm_messages",
            "DELETE FROM dm_messages WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - interval '30 days'",
        ),
        (
            "invites",
            "DELETE FROM invites WHERE redeemed_at IS NULL AND expires_at < NOW() - interval '30 days'",
        ),
    ];

    let mut total_removed = 0u64;
    for (name, sql) in queries {
        match sqlx::query(sql).execute(pg).await {
            Ok(r) => {
                let n = r.rows_affected();
                if n > 0 {
                    tracing::info!(table = %name, removed = n, "cleanup");
                }
                total_removed += n;
            }
            Err(e) => {
                tracing::warn!(table = %name, ?e, "cleanup query failed");
            }
        }
    }

    // Trashed-post purge — handled separately because it must cascade to rows
    // that reference a post by a bare UUID (no FK): `notifications.target_id`
    // and `reports.target_id`. Without this, purging a post leaves dangling
    // notifications/reports that 404 when opened. We also skip any post that
    // still has a *live* reply, so the `reply_to_id … ON DELETE SET NULL`
    // never silently re-parents a live reply into a root post (thread
    // corruption). All three deletes run in one statement (atomic snapshot).
    match sqlx::query(
        r#"
        WITH purged AS (
            DELETE FROM posts p
            WHERE p.deleted_at IS NOT NULL
              AND p.deleted_at < NOW() - interval '30 days'
              AND NOT EXISTS (
                  SELECT 1 FROM posts c
                  WHERE c.reply_to_id = p.id AND c.deleted_at IS NULL
              )
            RETURNING id
        ),
        del_notifs AS (
            DELETE FROM notifications
            WHERE target_kind = 'post' AND target_id IN (SELECT id FROM purged)
            RETURNING 1
        )
        DELETE FROM reports
        WHERE target_kind = 'post' AND target_id IN (SELECT id FROM purged)
        "#,
    )
    .execute(pg)
    .await
    {
        Ok(r) => {
            total_removed += r.rows_affected();
        }
        Err(e) => {
            tracing::warn!(?e, "cleanup posts_trashed purge failed");
        }
    }

    tracing::debug!(
        total = total_removed,
        ms = started.elapsed().as_millis() as u64,
        "cleanup pass"
    );
}
