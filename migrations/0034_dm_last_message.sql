-- 0034: denormalize each DM thread's last message (100k roadmap — DM thread list).
--
-- The thread list (GET /dm/threads) ran two correlated subqueries per thread to
-- fetch the last message's body + sender (each an indexed scan of dm_messages, but
-- one per row, so 2×N seeks for a user with N conversations on a hot, oft-opened
-- screen). Cache the newest non-deleted message on the thread row instead.
--
-- The per-user "clear conversation" (a_cleared_at / b_cleared_at) is still honored
-- by the list's EXISTS filter: a thread is listed only when a non-deleted message
-- exists after the viewer's clear, and the cached message IS the newest non-deleted
-- one (max created_at) — so for every listed thread it is necessarily after the
-- clear, i.e. the message the viewer should see. No viewer-specific column needed.

ALTER TABLE dm_threads ADD COLUMN IF NOT EXISTS last_body TEXT;
ALTER TABLE dm_threads ADD COLUMN IF NOT EXISTS last_sender_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Backfill from each thread's newest non-deleted message.
UPDATE dm_threads t SET
    last_body      = m.body,
    last_sender_id = m.sender_id
FROM (
    SELECT DISTINCT ON (thread_id) thread_id, body, sender_id
    FROM dm_messages
    WHERE deleted_at IS NULL
    ORDER BY thread_id, created_at DESC
) m
WHERE m.thread_id = t.id;
