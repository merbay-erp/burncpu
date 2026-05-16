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
    tracing::debug!(
        total = total_removed,
        ms = started.elapsed().as_millis() as u64,
        "cleanup pass"
    );
}
