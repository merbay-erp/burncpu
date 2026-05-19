-- 0011 — granular API token scopes
--
-- Keeps `all` and `read`, and adds `read:<resource>` /
-- `write:<resource>` for narrower automation tokens. Admin/auth/token
-- management routes remain session-only in application middleware.

ALTER TABLE api_tokens DROP CONSTRAINT IF EXISTS api_tokens_scope_check;

ALTER TABLE api_tokens
    ALTER COLUMN scope TYPE VARCHAR(64),
    ADD CONSTRAINT api_tokens_scope_check
    CHECK (
        scope IN ('all', 'read')
        OR scope ~ '^(read|write):(profile|notifications|bookmarks|posts|webhooks|dm|feed|search|trending|media|invites|push)$'
    );
