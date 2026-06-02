# Changelog

All notable changes to burncpu are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); the project is pre-1.0 and
ships continuously to [burncpu.com](https://burncpu.com) from `main`.

## [Unreleased]

### Added
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
- New **Ember** palette (warm charcoal / cream) + Geist Mono across the app.
- Single brand mark with animated "burn" wordmark; redesigned logo (flame).
- Timeline tabs (Bana Özel / Global) replace the duplicate sidebar entries.
- Trending, Hashtag, Bookmarks, Trash, and Login pages rebuilt on the shared
  `<Post>` / Tailwind design system.

### Fixed
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
