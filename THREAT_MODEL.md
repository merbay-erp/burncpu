# burncpu — threat model

> Live document. Updated as features land.
> Last revised: 2026-05-16 (Hafta 1)

## Scope

Public-facing social platform at https://burncpu.com. Single VPS,
single Postgres, single admin (initially). All assets covered:

- Edge: Cloudflare (proxy, WAF rules, basic DDoS)
- Origin: nginx (TLS termination, security headers, real-IP)
- App: Rust/Axum on `127.0.0.1:3060`
- Data: Postgres 16, Redis 7, Meilisearch v1.10 (all on docker bridge)

Out of scope (current sprint): federation (ActivityPub), CDN for media,
email provider (still console-only).

## Actors

| Who | Capability | Motive |
|-----|-----------|--------|
| Anonymous visitor | Read public posts, request magic link | Browse / harass / scrape |
| Authenticated user | CRUD own profile, post, follow | Normal use, possible abuse |
| Admin (Mustafa) | Moderation, user mgmt, server access | Operate platform |
| External attacker | Network access only | Credential theft, spam, DoS |
| Insider (future) | Server SSH access | Disgruntled / compromised account |
| Bot / AI farm | Mass account creation, automated posting | Spam, manipulation |

## Trust boundaries

```
Internet ─► Cloudflare ─► nginx (TLS) ─► Axum (3060) ─► PG/Redis (docker net)
              [WAF]        [headers]       [auth]        [no public port]
```

- **CF → nginx**: nginx trusts CF-Connecting-IP only from CF IP ranges
  (configured via `cloudflare/cloudflare-ips.conf`).
- **nginx → app**: app trusts `CF-Connecting-IP` / `X-Real-IP` headers
  because port 3060 is bound to 127.0.0.1 only.
- **app → DB**: docker bridge `burncpu-net`. No public exposure of PG/Redis.

## Asset inventory & sensitivity

| Asset | Sensitivity | Storage | Notes |
|-------|-------------|---------|-------|
| User email | High (PII) | PG `users.email`, `auth_tokens.email`, `login_attempts.email` | Lowercased, citext |
| Magic-link raw token | Critical (15 min) | Email only — never persisted | sha256 stored |
| Session raw token | Critical (30 day) | Cookie only — sha256 stored | HttpOnly, Secure, SameSite=Lax |
| Password | n/a | none — passwordless | by design |
| TOTP secret (admin) | Critical | PG `user_totp.secret_encrypted` | XChaCha20-Poly1305, key in env (Hafta 2) |
| Post body | Medium | PG `posts.body` | Public; XSS-sanitized via ammonia |
| Audit log | Medium | PG `audit_log` | 90-day retention |
| Login attempts | Medium | PG `login_attempts` | Indefinite, scrubbed manually |
| Postgres password | Critical | VPS `/opt/burncpu/.env` (chmod 600) | Never in repo |
| Meili master key | High | same `.env` | Never in repo |

## Threats (STRIDE)

### Spoofing

| Threat | Vector | Mitigation |
|--------|--------|------------|
| Session hijack | Stolen cookie | HttpOnly + Secure + SameSite=Lax; UA/IP delta flag on session |
| Magic-link replay | Stolen email / MITM | One-shot (consumed_at), 15-min TTL, TLS-only delivery |
| IP spoofing via headers | Forged X-Forwarded-For | nginx accepts CF headers only from CF IPs |
| Account takeover via email change | Future feature | Pending: require re-verify of new email |

### Tampering

| Threat | Vector | Mitigation |
|--------|--------|------------|
| SQL injection | User input → query | sqlx parameterized binds (no string interpolation) |
| XSS in post body | Stored XSS | `ammonia` sanitizer on render (Hafta 1 — post CRUD) |
| CSRF on state-changing endpoints | Cross-origin POST | SameSite=Lax cookies + CSRF token (Hafta 2) |
| Cookie/header injection | Smuggled `\r\n` | axum/hyper rejects malformed headers |

### Repudiation

| Threat | Vector | Mitigation |
|--------|--------|------------|
| User denies posting X | "Wasn't me" | `audit_log` row per request + `login_attempts` with IP/UA |
| Admin denies action | Server-side mutation | All API requests have UUID request_id surfaced in `x-request-id` |

### Information Disclosure

| Threat | Vector | Mitigation |
|--------|--------|------------|
| Email enumeration on /auth/request | 200 vs 404 timing | Always returns 204; rate-limited per (IP, email) |
| Token leak via logs | Magic link in URL → access log | Path `/auth/verify/{token}` is logged in audit_log; tokens are one-shot + short TTL. **Mitigation gap: rotate logs / consider masking** |
| Stack traces to client | Panic mid-request | `AppError` masks internals; `tracing` records details server-side |
| PG/Redis exposure | Misconfigured port | Ports bound to 127.0.0.1 only; docker network isolated |
| Cookie leak via Referer | Outbound link | `Referrer-Policy: no-referrer` set globally |

### Denial of Service

| Threat | Vector | Mitigation |
|--------|--------|------------|
| Magic-link email flood | Single attacker mailing many users | Per-(IP, email) Redis rate limit: 3/hour |
| Login brute force | Token guessing | 256-bit tokens, sha256 lookup; rate limit |
| Slow-loris / large body | Long-lived conns | tower-http timeout + body limit (Hafta 2) |
| Database connection exhaustion | App-level connection leak | sqlx pool bounds; healthcheck on PG |
| Cloudflare-bypassing direct IP attack | Origin IP leak | nginx + app only listen on 127.0.0.1 for direct port; CF in front of :443 |

### Elevation of Privilege

| Threat | Vector | Mitigation |
|--------|--------|------------|
| Member → admin via API | Missing role check | All admin routes will require `CurrentUser.role == "admin"` (extractor in Hafta 2) |
| First-user-becomes-admin abuse | Anyone signs up first | Already used — Mustafa is admin |
| Container escape | Kernel exploit | Non-root user (`burncpu:1001`) inside image; no `--privileged` |
| Stolen .env → full DB | SSH compromise | chmod 600; defense-in-depth via fail2ban + ssh key-only (VPS hardening) |

## Specific risks accepted (for now)

1. **No 2FA on admin yet.** Schema is ready (`user_totp`); enrollment flow lands Hafta 2. Until then, magic link is the only factor — but admin email is on a separate provider with 2FA.
2. **Federation deferred.** ActivityPub introduces a long tail of abuse vectors (relay spam, remote-content cache, illegal content propagation). We deliberately ship single-instance first and grow the moderation muscle.
3. **No automated backups yet.** Postgres data is on VPS volume; nightly `pg_dump` to S3-compatible storage lands Hafta 2.
4. **AI moderation is a future feature.** Until then, spam relies on rate limits + manual admin review.
5. **No WAF rules beyond Cloudflare defaults.** Customized rules require pattern observation — wait for real traffic.
6. **Audit log fills indefinitely until cron.** 90-day retention is documented (`audit_log` table COMMENT) but cleanup job is manual.

## Operational hygiene

- Secrets only in `/opt/burncpu/.env` (chmod 600, root-owned).
- `.env` and `*.env*` covered by `.gitignore`.
- CI runs `cargo audit`, `cargo deny`, `gitleaks` on every push (see `.github/workflows/security.yml`).
- HSTS preload enabled (2 years).
- TLS via Let's Encrypt, auto-renewed.

## Incident response

If you suspect a compromise:

1. Revoke all sessions: `UPDATE sessions SET revoked_at = NOW() WHERE revoked_at IS NULL;`
2. Rotate `.env` secrets and `docker compose up -d --force-recreate`.
3. Inspect `audit_log` + `login_attempts` for the affected window.
4. Email mustafa@mustafaerbay.com.tr.

For external reporters: see [SECURITY.md](SECURITY.md).
