-- 0012 — report dedupe + hot-path indexes (additive, safe to re-run)

-- ─── Report dedupe ─────────────────────────────────────────────
-- One *open* report per (reporter, target). Without this a single account
-- can POST the same report unbounded times, flooding the admin queue and
-- manufacturing apparent consensus against a target. Resolving the report
-- (sets resolved_at) frees the slot so a genuine re-report is still possible.
-- Paired with `ON CONFLICT … DO NOTHING` in routes/reports.rs so a repeat
-- report is an idempotent no-op rather than a duplicate row.

-- First collapse any pre-existing duplicate OPEN reports (keep the earliest
-- per group), otherwise the unique index below can't be built on live data.
DELETE FROM reports r
USING reports r2
WHERE r.resolved_at IS NULL
  AND r2.resolved_at IS NULL
  AND r.reporter_id = r2.reporter_id
  AND r.target_kind = r2.target_kind
  AND r.target_id   = r2.target_id
  AND (r.created_at > r2.created_at
       OR (r.created_at = r2.created_at AND r.id > r2.id));

CREATE UNIQUE INDEX IF NOT EXISTS reports_dedupe_idx
    ON reports (reporter_id, target_kind, target_id)
    WHERE resolved_at IS NULL;

-- ─── DM unread hot path ────────────────────────────────────────
-- list_threads runs a per-thread `COUNT(*) WHERE read_at IS NULL` and
-- mark_read filters the same predicate; the (thread_id, created_at) index
-- can't serve it, forcing a per-thread scan. Partial index mirrors
-- notifications_unread_idx.
CREATE INDEX IF NOT EXISTS dm_messages_unread_idx
    ON dm_messages (thread_id)
    WHERE read_at IS NULL AND deleted_at IS NULL;

-- ─── Bookmarks FK-cascade index ────────────────────────────────
-- bookmarks cascades on post delete via post_id, but the PK is
-- (user_id, post_id) so the FK enforcement sequential-scans `bookmarks`
-- for every purged post. Index the trailing FK column.
CREATE INDEX IF NOT EXISTS bookmarks_post_idx ON bookmarks (post_id);
