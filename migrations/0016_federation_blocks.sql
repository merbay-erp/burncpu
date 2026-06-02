-- Instance-level defederation: the one moderation lever federation needs.
-- A blocked host's inbound activities are rejected, and it is skipped on
-- outbound fanout. Host-keyed (covers every actor on that instance).

CREATE TABLE federation_blocks (
    host        TEXT PRIMARY KEY,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
