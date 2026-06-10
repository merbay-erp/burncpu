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
//
// Filesystem (best-effort, after the DB pass):
//   - media_dir/*   : files no `media` row references, 24h age floor (sweep_orphan_media)
//   - media_dir/c/* : optimized link-preview covers unreferenced >10d (sweep_cover_cache)

use sqlx::PgPool;
use std::time::Duration;

const INTERVAL: Duration = Duration::from_secs(3600); // 1h
const INITIAL_DELAY: Duration = Duration::from_secs(60);

pub fn spawn(pg: PgPool, media_dir: String) {
    tokio::spawn(async move {
        tokio::time::sleep(INITIAL_DELAY).await;
        let mut tick = tokio::time::interval(INTERVAL);
        // skip the immediate first tick (we already slept)
        tick.tick().await;
        loop {
            run_once(&pg, &media_dir).await;
            tick.tick().await;
        }
    });
}

async fn run_once(pg: &PgPool, media_dir: &str) {
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
        // Partitioned (migration 0035): retention is a DROP of old monthly
        // partitions, not a DELETE scan. manage_log_partitions also creates the
        // upcoming months ahead of time and sweeps the DEFAULT partition.
        (
            "audit_log partitions",
            "SELECT manage_log_partitions('audit_log', 4)",
        ),
        (
            "login_attempts partitions",
            "SELECT manage_log_partitions('login_attempts', 7)",
        ),
        // Trending materialized views (migration 0036): refresh hourly so the 24h
        // surfaces are precomputed, not regex-scanned on read. CONCURRENTLY never
        // blocks readers (relies on the views' unique indexes).
        (
            "trending_hashtags_24h",
            "REFRESH MATERIALIZED VIEW CONCURRENTLY trending_hashtags_24h",
        ),
        (
            "trending_posts_24h",
            "REFRESH MATERIALIZED VIEW CONCURRENTLY trending_posts_24h",
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
        // Federated explore cache (migration 0038). It's a discovery surface for
        // *recent* remote posts, not an archive, so evict by ingest time — keyed
        // on ingested_at (when we stored it), never the remote-controlled
        // published_at, so a peer can't dodge eviction by back-dating.
        (
            "remote_posts",
            "DELETE FROM remote_posts WHERE ingested_at < NOW() - interval '30 days'",
        ),
        // Orphan media rows: a media row whose file no surviving post body,
        // avatar, or DM still references (a post hard-delete leaves its row +
        // file behind — post images live in posts.body markdown, not post_media).
        // 30-day floor so an in-flight or just-detached upload is never caught.
        // sweep_orphan_media then reclaims the now-unreferenced file from disk.
        // NOTE: at very large scale these body-LIKE scans want a denormalized
        // media-reference table; fine for now, runs hourly off the hot path.
        (
            "media_orphans",
            "DELETE FROM media m \
             WHERE m.created_at < NOW() - interval '30 days' \
               AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.body LIKE '%' || m.filename || '%') \
               AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_url LIKE '%' || m.filename) \
               AND NOT EXISTS (SELECT 1 FROM dm_messages d WHERE d.media_url LIKE '%' || m.filename) \
               AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.url LIKE '%' || m.filename)",
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

    sweep_orphan_media(pg, media_dir).await;
    sweep_cover_cache(media_dir).await;

    tracing::debug!(
        total = total_removed,
        ms = started.elapsed().as_millis() as u64,
        "cleanup pass"
    );
}

/// Remove files in `media_dir` that no surviving `media` row references —
/// leftover `.tmp` files from interrupted transcodes, and files whose row was
/// deleted but whose unlink failed. A 24h age floor keeps it from ever racing a
/// fresh upload or an in-flight transcode (whose row may not be committed yet).
async fn sweep_orphan_media(pg: &PgPool, media_dir: &str) {
    let mut entries = match tokio::fs::read_dir(media_dir).await {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut removed = 0u64;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Ok(meta) = entry.metadata().await else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let recent = meta
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|age| age < Duration::from_secs(24 * 3600))
            .unwrap_or(true);
        if recent {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let referenced: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM media WHERE filename = $1 OR transcoded_filename = $1 OR poster_filename = $1)",
        )
        .bind(&name)
        .fetch_one(pg)
        .await
        .unwrap_or(true); // on error, keep the file — never delete something we might reference
        if !referenced && tokio::fs::remove_file(entry.path()).await.is_ok() {
            removed += 1;
        }
    }
    if removed > 0 {
        tracing::info!(removed, "cleanup swept orphan media files");
    }
}

/// Evict optimized link-preview covers under `media_dir/c/` once they fall out of
/// use. `cover_cache::optimize` bumps a cover's mtime every time its preview
/// re-resolves, and a preview's redis entry lives at most `CACHE_TTL_OK` (7 days,
/// in `routes::link_preview`). So a cover whose mtime is older than 10 days has had
/// no live preview pointing at it for days — its redis entry already expired — and
/// deleting it cannot break a still-cached card. (In the rare race where a
/// just-evicted cover is viewed again, it simply regenerates on the next resolve.)
/// The `c/` subdir is handled here because `sweep_orphan_media` deliberately skips
/// subdirectories. Best-effort: errors are logged or ignored and the pass continues.
async fn sweep_cover_cache(media_dir: &str) {
    // > CACHE_TTL_OK (7d) plus margin for the hourly sweep cadence, clock skew, and
    // the gap between the mtime touch and the redis re-set.
    const MAX_AGE: Duration = Duration::from_secs(10 * 24 * 3600);

    let dir = std::path::Path::new(media_dir).join("c");
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(e) => e,
        Err(_) => return, // c/ may not exist yet — nothing to sweep
    };
    let mut removed = 0u64;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Ok(meta) = entry.metadata().await else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let stale = meta
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|age| age > MAX_AGE)
            .unwrap_or(false); // unknown/future mtime → keep (never evict on uncertainty)
        if stale && tokio::fs::remove_file(entry.path()).await.is_ok() {
            removed += 1;
        }
    }
    if removed > 0 {
        tracing::info!(removed, "cleanup evicted stale cover-cache files");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn sweep_cover_cache_evicts_only_stale() {
        let base = std::env::temp_dir().join(format!("burncpu_covsweep_{}", std::process::id()));
        let c = base.join("c");
        std::fs::create_dir_all(&c).unwrap();

        let stale = c.join("old.jpg");
        let fresh = c.join("new.jpg");
        std::fs::write(&stale, b"x").unwrap();
        std::fs::write(&fresh, b"y").unwrap();
        // Age the stale cover past the 10-day window; leave the fresh one at ~now.
        let old = std::time::SystemTime::now() - Duration::from_secs(11 * 24 * 3600);
        std::fs::OpenOptions::new()
            .write(true)
            .open(&stale)
            .unwrap()
            .set_modified(old)
            .unwrap();

        sweep_cover_cache(base.to_str().unwrap()).await;

        assert!(!stale.exists(), "a cover older than the window must be evicted");
        assert!(fresh.exists(), "a fresh cover must be kept");

        std::fs::remove_dir_all(&base).ok();
    }

    #[tokio::test]
    async fn sweep_cover_cache_missing_dir_is_noop() {
        // No c/ subdir present → must not panic, just return.
        let base =
            std::env::temp_dir().join(format!("burncpu_covsweep_missing_{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        sweep_cover_cache(base.to_str().unwrap()).await;
        std::fs::remove_dir_all(&base).ok();
    }
}
