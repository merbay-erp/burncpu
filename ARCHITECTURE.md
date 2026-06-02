# burncpu — Architecture

> How the pieces fit. Companion to the [README](README.md),
> [API reference](docs/API.md), and [threat model](THREAT_MODEL.md).
> Last revised: 2026-06-02.

The guiding constraint is **one VPS**. Every design choice flows from it:
a single binary, a single Postgres, an in-process broadcast bus instead of
a message queue, read-time computation instead of precomputed pipelines.
Scale vertically and stay legible.

## 1. System overview

```
                        ┌────────────────────────────────────────────┐
  Internet ─► Cloudflare │ nginx (:443, TLS, security headers, real-IP)│
              [WAF/DDoS] └───────────────┬────────────────────────────┘
                                         │ proxy_pass 127.0.0.1:3060
                            ┌────────────▼─────────────┐
                            │   Axum app (single bin)   │
                            │  routes · middleware · SSE │
                            └───┬─────────┬──────────┬──┘
                       docker bridge net (no public ports)
                  ┌──────────┘         │          └───────────┐
            ┌─────▼─────┐        ┌──────▼─────┐         ┌──────▼──────┐
            │ Postgres  │        │   Redis    │         │ Meilisearch │
            │  (truth)  │        │ rate/cache │         │   search    │
            └───────────┘        └────────────┘         └─────────────┘
```

- **Edge** — Cloudflare proxies `:443` and provides WAF + basic DDoS.
- **Origin** — nginx terminates TLS, sets security headers, forwards the
  real client IP (`CF-Connecting-IP`, trusted only from Cloudflare ranges).
- **App** — one Rust/Axum binary on `127.0.0.1:3060`. Not publicly bound.
- **Data** — Postgres (source of truth), Redis (rate-limit + ephemeral
  lookups), Meilisearch (typo-tolerant search). All on a private docker
  bridge with no exposed ports.

## 2. Request lifecycle

Middleware is applied outer-to-inner; on the **request path** the order is:

```
DefaultBodyLimit(6 MiB)
   └─ audit::layer        attaches a request UUID (x-request-id), records the row
       └─ session::layer  resolves the session cookie → CurrentUser (or anon)
           └─ csrf::layer  rejects cookie-authenticated cross-origin state changes
               └─ TraceLayer / CompressionLayer
                   └─ handler
```

- **`middleware::audit`** — stamps every request with a UUID surfaced as
  `x-request-id` and writes an `audit_log` row (sensitive paths redacted).
- **`middleware::session`** — reads the `HttpOnly; Secure; SameSite=Lax`
  session cookie, looks up the sha256-hashed token, and injects a
  `CurrentUser` extractor. Flags UA/IP deltas as possible hijack.
- **`middleware::csrf`** — for state-changing methods, requires same-origin
  (defense-in-depth on top of `SameSite=Lax`).
- **`middleware::client_ip`** — resolves the trusted client IP for
  rate-limiting and audit.

Handlers obtain identity through axum extractors:
`CurrentUser` (required auth), `Option<CurrentUser>` (anon-safe),
`AdminUser` (role + 2FA gate). See `src/middleware/auth_extractor.rs`.

## 3. Backend layout

```
src/
├── main.rs            Router assembly + the layer stack above
├── state.rs           AppState (pg, redis, search, config, notif_tx broadcast)
├── config.rs          Env-driven config
├── errors.rs          AppError → HTTP mapping; masks internals, logs detail
├── db.rs              Pool construction + migration runner
├── net_safety.rs      SSRF-safe reqwest client (IP-pinned, redirects off)
├── cleanup.rs         Retention jobs (audit log, trash, tokens)
├── routes/            One module per API resource (see §6 + docs/API.md)
├── middleware/        audit · session · csrf · client_ip · auth_extractor
├── auth/              email (SMTP) · totp · token · scope
├── content/           Markdown render + ammonia sanitize
├── search/            Meilisearch indexing + query (anon-safe filter)
└── federation/        ActivityPub: sign (HTTP Signatures) + fanout + webfinger
```

**Conventions**
- Routes are thin; each `routes/<resource>.rs` exposes a `router()` mounted
  under `/api/v1/<resource>` in `routes/api.rs`.
- SQL uses **sqlx** parameterized binds exclusively — never string
  interpolation. Most reads use `query_as` with `FromRow` by column name.
- Errors return `Result<T, AppError>`; `AppError` owns the status mapping and
  never leaks internals to the client.
- Background work (search indexing, federation fanout, email) is dispatched
  with `tokio::spawn` so the request returns immediately.

## 4. Data model

Postgres 16 is the single source of truth. Schema evolves through ordered
sqlx migrations in `migrations/`, run automatically on startup.

| Migration | Brings |
|-----------|--------|
| `0001_init` | users, posts, follows, sessions, auth_tokens, login_attempts |
| `0002_security` | audit_log, hardening, indexes |
| `0003_notifications` | notifications + unread tracking |
| `0004_session_2fa` | `user_totp`, recovery codes, session 2FA state |
| `0005_media_bookmarks_edits` | media, bookmarks, post edit history |
| `0006_dms` | dm_threads, dm_messages |
| `0007_tokens_webhooks` | API tokens, webhook subscriptions |
| `0008_push` | Web Push subscriptions (VAPID) |
| `0009_federation` | actors, inbox/outbox, remote follows |
| `0010_safety` | blocks, mutes, reports |
| `0011_token_scopes` | scoped API token grants |
| `0012_report_dedupe_and_indexes` | report dedupe + hot-path indexes |

Principles: UUID primary keys, `created_at`/`deleted_at` timestamps
(soft-delete via `deleted_at`), JSONB for flexible metadata, and
**keyset pagination** on `(created_at, id)` for stable, skip-free timelines.

## 5. Auth & sessions

**Magic-link (passwordless).** `POST /auth/request` rate-limits per
`(IP, email)` in Redis and emails a 256-bit one-shot token (sha256 stored,
15-min TTL). The link points at a scanner-safe confirm page; consuming the
token (`POST`) starts a session. `/auth/request` always returns `204` to
prevent email enumeration.

**Sessions.** A random token lives only in an `HttpOnly; Secure;
SameSite=Lax` cookie; the server stores its sha256. Sessions carry UA/IP
fingerprints; a delta raises a hijack flag.

**TOTP 2FA (admin gate).** RFC 6238 via `totp-rs`. The secret is encrypted
at rest with **XChaCha20-Poly1305** (key from env). Enrollment →
confirm-first-code → recovery codes. Admin routes require both role and a
2FA-satisfied session.

**API tokens.** Scoped, revocable bearer tokens (`auth/scope.rs`,
`auth/token.rs`) for programmatic access — e.g. publishing from an external
blog. See `docs/API.md` → Tokens.

## 6. Real-time (SSE)

A single in-process `tokio::sync::broadcast` channel (`AppState.notif_tx`)
fans events to every connected client. `GET /notifications/stream` subscribes
and **filters per connection**:

- `ev.user_id == viewer` → personal notifications (reaction, reply, follow,
  mention, DM) — also persisted and counted toward the unread badge.
- `kind == "typing"` → forwarded only to the DM recipient (ephemeral, no
  persistence, no badge).
- `kind == "new_post"` → **firehose**: a new top-level public post fans out
  to everyone *except its author*. The global timeline turns this into a
  live "N new signals" pill instead of yanking the reader's scroll.

No external broker — the broadcast bus is enough for a single instance and
disappears cleanly on restart (clients auto-reconnect with backoff).

## 7. Search & trending

**Search** indexes only live public posts into Meilisearch (fire-and-forget
on post create). Queries hard-code a `live + public` filter so private and
follower-only posts never leak. Results are enriched with author display
names + avatars before returning.

**Trending** is computed at read time straight from Postgres (regex hashtag
extraction; reaction+reply score over a time window). Cheap at this scale;
the plan at higher volume is an hourly materialized view.

## 8. Content safety

- **Markdown** is rendered with `pulldown-cmark`, then **sanitized with
  ammonia** to an allowlist of safe tags/attributes — stored XSS is removed
  at render, not trusted from input.
- **Link previews** fetch Open Graph metadata through `net_safety`: an
  **SSRF-safe client** that resolves and pins the target IP, refuses private
  ranges, disables redirects, and caps the streamed body. Results are cached
  in Redis. Raw URLs are hidden in the UI once a card resolves.
- **Media** uploads are sniffed (`infer`), **EXIF-stripped and re-encoded**
  via `image`, and size-capped by the 6 MiB body limit.

## 9. Federation (ActivityPub)

Standards-compliant server-to-server federation lives in `src/federation/`:

- **Discovery** — `/.well-known/webfinger`, `/nodeinfo/2.1`.
- **Actors & collections** — under `/ap/*`.
- **HTTP Signatures** — outbound activities are signed RSA-SHA256
  (`federation/sign.rs`); inbound signatures are verified.
- **Fanout** — on a public post, `federation::fanout_post` delivers to remote
  followers in a background task (no-op when `FEDERATION_ENABLED=false`).

Federation ships behind a flag: single-instance culture first, then widen.

## 10. Frontend architecture

A SolidJS SPA in `web/` (TypeScript, Vite, Tailwind). See
[web/README.md](web/README.md) for the dev workflow.

- **Routing** — `@solidjs/router`; `Layout.tsx` is the root shell (top nav,
  sidebars, bottom nav, global overlays). Pages are lazy-loaded.
- **API client** — a tiny `fetch` wrapper (`api.ts`) targeting `/api/v1`,
  `credentials: include`. In dev, Vite proxies `/api` → burncpu.com.
- **Theming** — CSS-variable tokens `rgb(var(--c-NAME) / <alpha>)`, surfaced
  through Tailwind. Dark default + `html.light`; an inline no-flash script
  applies the saved theme before first paint. Palette: **Ember** (warm
  charcoal / cream) with Geist Mono.
- **i18n** — flat `t(key)` dictionary (TR/EN), ~230 keys.
- **Real-time** — a single SSE connection in `Layout` dispatches DOM
  `CustomEvent`s (`burncpu:posted`, `burncpu:newpost`, `burncpu:typing`,
  `burncpu:notification`) that pages subscribe to.
- **Command palette** — `⌘K` (`CommandPalette.tsx`): navigation, quick
  actions, and live people/post search; also reachable from the search bar
  and the mobile search tab.
- **Patterns** — `InfiniteList` (IntersectionObserver sentinel + keyset
  cursor); the **synthesize-PostView** pattern (lean rows → `PostView` →
  reuse `<Post>`) shared across Profile, Bookmarks, Hashtag, Trending;
  shared `<Avatar>`, `<Skeleton>`, `<AuthGate>`, `<LinkCard>` primitives.

## 11. Deployment & CI

Two GitHub Actions workflows:

- **`deploy.yml`** — on push to `main`, a **self-hosted runner** on VPS3 runs
  `deploy-burncpu.sh` (builds backend + frontend, runs migrations, restarts),
  then verifies `/healthz`. Backend changes ≈9 min; frontend-only ≈1 min.
- **`security.yml`** — `cargo audit`, `cargo deny`, and `gitleaks` on every
  push.

**Verifying a deploy:** `/healthz` returns `200`, and the live JS bundle hash
(`index-*.js` referenced by `/`) matches the locally built `web/dist`.

Secrets live only in `/opt/burncpu/.env` (chmod 600, root-owned), never in
the repo (`.gitignore` covers `*.env*`).

## 12. Observability & operations

- **Tracing** — `tracing` + `tracing-subscriber` (JSON in prod). Every
  request carries `x-request-id` for correlation.
- **Audit** — `audit_log` (request-level) + `login_attempts` (IP/UA), with
  retention jobs in `cleanup.rs`.
- **Health** — `/healthz` pings Postgres + Redis; returns `503` if unhealthy.
- **Backups** — nightly `pg_dump` with 7-day rotation.
- **Incident response** — see [THREAT_MODEL.md → Incident response](THREAT_MODEL.md#incident-response).

---

*This is a living document — update it as subsystems change.*
