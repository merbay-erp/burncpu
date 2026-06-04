# Changelog

All notable changes to burncpu are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); the project is pre-1.0 and
ships continuously to [burncpu.com](https://burncpu.com) from `main`.

## [Unreleased]

### Added
- **Multi-layered spam scoring** — top-level public posts are scored across
  independent layers (account trust, link density, mention flooding, shouting,
  a configurable `SPAM_DENYLIST`) and quarantined at/above `SPAM_THRESHOLD`,
  replacing the blunt new-account gate. Clean first posts from new users now go
  live; signal-laden ones land in the existing admin review queue.
- **Social login + open signup** — sign in with Google, GitHub, or Microsoft
  (OAuth2 authorization-code + PKCE + state; matched/created by verified email).
  Invite-only registration removed — signup is open on web and mobile.
- **Direct messaging** — a full DM system over the mutual-follow gate: image &
  video attachments (fullscreen viewer / player), per-message emoji reactions,
  sent/read status ticks + timestamps, delete message, bulk-select delete,
  per-user delete-conversation, new-message compose (user search), typing
  indicator, and a new-message sound.
- **Mobile app** — React Native / Expo (Android, sideloaded APK): native push
  (Expo → FCM/APNs, with sound) that deep-links to the target screen, web-parity
  timeline / profile / DM, and unread badges on the Notifications & Messages tabs.
- **Video uploads** — `/media` accepts mp4/webm/mov up to 64 MiB (stored
  verbatim, range-served); the request-body limit is lifted per route while the
  global cap stays small.
- **⌘K command palette** — instant navigation, quick actions (new signal,
  toggle theme), and live people/post search; reachable via `⌘K`, the search
  bar, and the mobile search tab.
- **Real-time global timeline** — new public posts fan out over SSE; the
  timeline surfaces a live "N yeni sinyal" pill instead of yanking scroll.
- **Polished sign-in gate** (`<AuthGate>`) on every auth-gated page for
  logged-out visitors, with contextual icon + copy.
- Reaction flourish (animated pop + ember sparks) and profile **count-up**
  stats with an ember cover band.
- Route-transition fades and button press micro-interactions
  (`prefers-reduced-motion` aware).
- API docs page in-app, link previews (SSRF-safe), avatar cropper, composer
  toolbar + draft autosave.

### Changed
- "post" → **"sinyal"** wording across the UI (web + mobile).
- Read receipts shown as single / double ticks — read = sky-blue double check
  (WhatsApp-style) — instead of flat status text.
- `/media` now **downscales** oversized images (≤2048 px) and raises limits to
  12 MiB images / 64 MiB video.
- New **Ember** palette (warm charcoal / cream) + Geist Mono across the app.
- Single brand mark with animated "burn" wordmark; redesigned logo (flame).
- Timeline tabs (Bana Özel / Global) replace the duplicate sidebar entries.
- Trending, Hashtag, Bookmarks, Trash, and Login pages rebuilt on the shared
  `<Post>` / Tailwind design system.
- Followed-topic home feed now resolves hashtags through a materialized
  `post_hashtags` index (migration 0024) instead of a per-row body regex
  re-run for every followed tag on every page — same matches, indexed lookup.
- Session **anomaly flag** now triggers on a User-Agent change only; IP drift
  alone (mobile networks, CGNAT, wifi↔cellular) was almost all noise and made
  the flag meaningless. The new IP is still recorded for the admin view.
- Web Push fan-out is bounded per user, so one notification can't spawn an
  unbounded burst of concurrent sends.
- `openapi.json` now documents the OAuth, Web Push, and newer DM operations; a
  test keeps the in-app API index (`GET /api/v1/`) and the spec from drifting.

### Fixed
- Avatar cropper showed an empty circle — the CSP blocked the `blob:` preview
  image; switched to a `data:` URL (already allowed by the policy).
- Mobile writes (post / react / follow / avatar) failed the CSRF guard — native
  fetch now sends an `Origin` header.
- Replies appeared as standalone signals in the home & global feeds.
- DM: thread back button was hidden on desktop; the unread badge stayed stale
  while a thread was open; the reaction picker offered emoji the server rejected.
- Emoji picker: panel was clipped by the toolbar's `overflow-x-auto` and the
  search autofocus scrolled the page. Now renders in a Portal with fixed
  positioning + `preventScroll`.
- Timeline no longer sticks on skeletons until first scroll.
- Mobile horizontal-overflow and composer-toolbar overflow regressions.

## [0.1.0] — Alpha foundation

### Added
- **Auth** — passwordless magic-link (15-min one-shot tokens), sessions with
  hijack flagging, **TOTP 2FA** (admin gate, encrypted secret, recovery
  codes), invite-only signup, account data export.
- **Content** — markdown posts with ammonia XSS sanitization, reposts,
  threaded replies, bookmarks, trash + restore, single-emoji reactions.
- **Social** — profiles, follow graph, personal + global feeds, blocks,
  mutes, reports, mutual-follow DMs with typing indicators.
- **Discovery** — Meilisearch search, hashtag pages, trending (hashtags +
  posts), SSE notifications.
- **Federation & distribution** — ActivityPub (RSA-SHA256 HTTP Signatures,
  WebFinger, NodeInfo), RSS/Atom feeds, Web Push (VAPID), webhooks, scoped
  API tokens.
- **Frontend** — SolidJS SPA (PWA shell, dark/light themes, TR/EN i18n).
- **Ops** — `/healthz`, audit log + `x-request-id`, real SMTP delivery,
  nightly Postgres backups (7-day rotation), self-hosted CI deploy.

### Security
- SSRF-safe HTTP client (IP-pinned, redirects off, body cap) for link
  previews and federation fetches.
- Per-(IP, email) rate limiting; CSRF middleware on cookie-authenticated
  state changes; security CI (`cargo audit`, `cargo deny`, `gitleaks`).

---

[Unreleased]: https://github.com/merbay-erp/burncpu/compare/main...HEAD
