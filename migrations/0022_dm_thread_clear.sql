-- "Delete conversation" is per-user: clearing a thread hides it — and its
-- history up to that moment — from one side only. A later message un-hides it,
-- and the other person is never affected. Two nullable timestamps, one per side
-- of the canonical (a_id < b_id) pair.
ALTER TABLE dm_threads ADD COLUMN a_cleared_at timestamptz;
ALTER TABLE dm_threads ADD COLUMN b_cleared_at timestamptz;
