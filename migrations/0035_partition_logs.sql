-- 0035: monthly RANGE partitioning for the append-only log tables audit_log and
-- login_attempts (100k roadmap — scale polish). At scale, retention becomes an
-- instant DROP of an old monthly partition instead of a DELETE + vacuum over
-- millions of rows; per-partition indexes also stay small. Nothing references
-- these tables (no inbound FKs), so partitioning is transparent to the rest of the
-- schema. The whole migration runs in one transaction — if anything fails it rolls
-- back wholesale and the original tables remain untouched.
--
-- notifications is deliberately NOT partitioned: it is read by user_id (the
-- per-user feed), not by time, so range-by-time partitioning would scatter a
-- user's rows and hurt that hot query. Its DELETE-based retention stays.
--
-- Design: a DEFAULT partition is the safety net so an insert can never fail for
-- lack of a partition (these tables are written on every request / auth attempt);
-- explicit current + next-month partitions take the new traffic; migrated history
-- lands in DEFAULT. crate::cleanup calls manage_log_partitions() hourly to create
-- the next month ahead of time, drop monthly partitions past retention, and sweep
-- stragglers from DEFAULT. The partition key (ts) must be in the primary key, so
-- the PK becomes (id, ts); id stays a unique UUID and is referenced by nothing.
--
-- Note: a table RENAME keeps its index names, so the old indexes (incl. the PK
-- index audit_log_pkey) would clash with the new ones. We rename the old PK index
-- aside, and create the new secondary indexes only AFTER dropping the old tables
-- (which also loads data index-free first — faster).

ALTER TABLE audit_log RENAME TO audit_log_old;
ALTER INDEX audit_log_pkey RENAME TO audit_log_old_pkey;

CREATE TABLE audit_log (
    id            UUID NOT NULL,
    method        VARCHAR(10) NOT NULL,
    path          VARCHAR(512) NOT NULL,
    status        SMALLINT NOT NULL,
    latency_ms    INTEGER NOT NULL,
    ip            INET,
    user_agent    VARCHAR(255),
    user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;

ALTER TABLE login_attempts RENAME TO login_attempts_old;
ALTER INDEX login_attempts_pkey RENAME TO login_attempts_old_pkey;

CREATE TABLE login_attempts (
    id          UUID NOT NULL DEFAULT gen_random_uuid(),
    email       CITEXT,
    kind        VARCHAR(16) NOT NULL
                CHECK (kind IN ('request', 'verify', 'totp')),
    outcome     VARCHAR(16) NOT NULL
                CHECK (outcome IN ('ok', 'rate_limited', 'invalid', 'expired', 'consumed', 'totp_required')),
    ip          INET,
    user_agent  VARCHAR(255),
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);
CREATE TABLE login_attempts_default PARTITION OF login_attempts DEFAULT;

-- Current + next month partitions, so live traffic lands in droppable units.
DO $$
DECLARE
    m0 date := date_trunc('month', now())::date;
    m1 date := (date_trunc('month', now()) + interval '1 month')::date;
    m2 date := (date_trunc('month', now()) + interval '2 months')::date;
    t  text;
BEGIN
    FOREACH t IN ARRAY ARRAY['audit_log', 'login_attempts'] LOOP
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                       t || '_y' || to_char(m0, 'YYYY') || 'm' || to_char(m0, 'MM'), t, m0, m1);
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                       t || '_y' || to_char(m1, 'YYYY') || 'm' || to_char(m1, 'MM'), t, m1, m2);
    END LOOP;
END $$;

-- Migrate history (index-free), then drop the originals (frees the old index names).
INSERT INTO audit_log SELECT * FROM audit_log_old;
INSERT INTO login_attempts SELECT * FROM login_attempts_old;
DROP TABLE audit_log_old;
DROP TABLE login_attempts_old;

-- Recreate the secondary indexes on the partitioned parents (propagate to all
-- partitions). The names are free now that the old tables are gone.
CREATE INDEX audit_log_ts_idx     ON audit_log(ts DESC);
CREATE INDEX audit_log_status_idx ON audit_log(status, ts DESC) WHERE status >= 400;
CREATE INDEX audit_log_ip_idx     ON audit_log(ip, ts DESC);
CREATE INDEX audit_log_user_idx   ON audit_log(user_id, ts DESC) WHERE user_id IS NOT NULL;
CREATE INDEX login_attempts_email_idx  ON login_attempts(email, ts DESC);
CREATE INDEX login_attempts_ip_idx     ON login_attempts(ip, ts DESC);
CREATE INDEX login_attempts_recent_idx ON login_attempts(ts DESC);

-- Self-sustaining partition maintenance, called hourly by crate::cleanup: ensure
-- the next few months' partitions exist, drop monthly partitions entirely older
-- than the retention window, and DELETE stragglers/history from DEFAULT.
CREATE OR REPLACE FUNCTION manage_log_partitions(tbl text, retain_months int) RETURNS void AS $$
DECLARE
    bound_start date;
    cutoff date := date_trunc('month', now() - make_interval(months => retain_months))::date;
    r record;
    part_month date;
BEGIN
    FOR i IN 0..2 LOOP
        bound_start := (date_trunc('month', now()) + make_interval(months => i))::date;
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                       tbl || '_y' || to_char(bound_start, 'YYYY') || 'm' || to_char(bound_start, 'MM'),
                       tbl, bound_start, (bound_start + interval '1 month')::date);
    END LOOP;

    FOR r IN
        SELECT c.relname
        FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = tbl::regclass
          AND c.relname ~ ('^' || tbl || '_y[0-9]{4}m[0-9]{2}$')
    LOOP
        part_month := to_date(substring(r.relname FROM '[0-9]{4}m[0-9]{2}$'), 'YYYY"m"MM');
        IF part_month < cutoff THEN
            EXECUTE format('DROP TABLE IF EXISTS %I', r.relname);
        END IF;
    END LOOP;

    EXECUTE format('DELETE FROM %I WHERE ts < %L', tbl || '_default',
                   now() - make_interval(months => retain_months));
END;
$$ LANGUAGE plpgsql;
