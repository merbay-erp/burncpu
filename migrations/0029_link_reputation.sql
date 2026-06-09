-- 0029: link / domain reputation — a decaying per-domain badness score
-- (100k roadmap, Phase 3 / P3).
--
-- Whenever a post is auto-quarantined (spam or report threshold) or removed by an
-- admin, the host names of the http(s) links it contains gain reputation points
-- (moderation::penalize_domains, weighted like the heat offense that triggered it).
-- create_post then folds the worst current score of a new post's domains into its
-- spam score, so a spammer's go-to domains "burn in": once a domain is associated
-- with enough quarantined/removed content, every future post linking it is far more
-- likely to be auto-quarantined.
--
-- bad_score decays with the SAME current_heat(score, updated_at) helper as account
-- heat (migration 0028) — 1 point/day — so a domain that stops appearing in bad
-- content cools back to neutral on its own, with no background job. The key is the
-- host string (lowercased, www-stripped); no eTLD+1 reduction, so sub.example.com
-- and example.com are tracked separately (acceptable — abuse usually reuses a host).

CREATE TABLE IF NOT EXISTS link_reputation (
    domain      TEXT PRIMARY KEY,
    bad_score   INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
