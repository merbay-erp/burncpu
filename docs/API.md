# burncpu — API Reference

Base URL: `https://burncpu.com/api/v1`
Companion to the [README](../README.md) and [ARCHITECTURE](../ARCHITECTURE.md).

## Conventions

- **Format** — JSON in, JSON out. `Content-Type: application/json`.
- **Auth** — session cookie (`HttpOnly; Secure; SameSite=Lax`) set by the
  magic-link flow, or a scoped bearer **API token**
  (`Authorization: Bearer <token>`). Requests are made with
  `credentials: include` from the SPA.
- **Anon-safe** endpoints work without a session; private/follower-only
  content never leaks to anonymous callers.
- **CSRF** — cookie-authenticated state-changing requests must be same-origin.
- **Errors** — non-2xx responses return `{ "error": "code", "message": "..." }`.
  Internals are never leaked. Every response carries an `x-request-id`.
- **Pagination** — timelines use **keyset** pagination: pass `before` (and
  `before_id` tie-breaker) from the previous page's `next_before*`.

Legend: 🔓 anon-ok · 🔒 auth required · 🛡️ admin (role + 2FA).

---

## Auth — `/auth`

| Method | Path | | Description |
|--------|------|--|-------------|
| `POST` | `/auth/request` | 🔓 | Request a magic link. Rate-limited per (IP, email). Always returns `204` (no email enumeration). |
| `GET` | `/auth/verify/{token}` | 🔓 | Redirect to the scanner-safe confirm page. |
| `POST` | `/auth/verify/{token}` | 🔓 | Consume the one-shot token → start session. |
| `POST` | `/auth/logout` | 🔒 | Revoke the current session. |
| `POST` | `/auth/2fa/enroll` | 🔒 | Begin TOTP enrollment (returns secret/QR). |
| `POST` | `/auth/2fa/confirm` | 🔒 | Confirm first code → activate; returns recovery codes. |
| `POST` | `/auth/2fa/challenge` | 🔒 | Satisfy 2FA for a pending session. |
| `POST` | `/auth/2fa/disable` | 🔒 | Disable TOTP (requires a valid code). |

## Social login — `/oauth`

OAuth2 authorization-code flow (state + PKCE). A provider is enabled when its
`{GOOGLE,GITHUB,MICROSOFT}_CLIENT_ID` / `_SECRET` env vars are set; accounts are
matched or created by **verified email** (`oauth_identities`).

| Method | Path | | Description |
|--------|------|--|-------------|
| `GET` | `/oauth/providers` | 🔓 | Enabled providers, for rendering the buttons. |
| `GET` | `/oauth/{provider}/start` | 🔓 | Begin the flow → redirect to the provider (sets state + PKCE). |
| `GET` | `/oauth/{provider}/callback` | 🔓 | Provider redirect target → exchange code, start a session. |
| `POST` | `/oauth/exchange` | 🔓 | Native (mobile) code exchange → returns a `Set-Cookie` session. |

## Posts — `/posts`

| Method | Path | | Description |
|--------|------|--|-------------|
| `GET` | `/posts` | 🔓 | Public global timeline (keyset: `?limit=&before=&before_id=`). |
| `POST` | `/posts` | 🔒 | Create a post (markdown, sanitized). Public top-level posts fan out over SSE. |
| `GET` | `/posts/{id}` | 🔓 | Single post. |
| `DELETE` | `/posts/{id}` | 🔒 | Soft-delete (author or admin) → trash. |
| `POST` | `/posts/{id}/restore` | 🔒 | Restore a soft-deleted post from trash. |
| `POST` | `/posts/{id}/react` | 🔒 | React (single-emoji). |
| `DELETE` | `/posts/{id}/react` | 🔒 | Remove your reaction. |
| `GET` | `/posts/{id}/reactions` | 🔓 | Reaction tally + the viewer's reaction. |
| `POST` | `/posts/{id}/replies` | 🔒 | Reply to a post. |
| `GET` | `/posts/{id}/thread` | 🔓 | Full conversation (root + descendants). |
| `POST` | `/posts/{id}/repost` | 🔒 | Repost. |

## Users — `/users`

| Method | Path | | Description |
|--------|------|--|-------------|
| `GET` | `/users/{username}` | 🔓 | Profile + counts + viewer-relative state. |
| `GET` | `/users/{username}/posts` | 🔓 | A user's posts. |
| `GET` | `/users/{username}/followers` | 🔓 | Followers list. |
| `GET` | `/users/{username}/following` | 🔓 | Following list. |
| `POST` | `/users/{username}/follow` | 🔒 | Follow. |
| `DELETE` | `/users/{username}/follow` | 🔒 | Unfollow. |
| `GET` | `/users/lookup?prefix=` | 🔓 | Username prefix lookup (mentions, command palette). |
| `PATCH` | `/users/me` | 🔒 | Update display_name / bio / avatar_url. |
| `GET` | `/users/me/activity` | 🔒 | Your account activity. |
| `GET` | `/users/me/security` | 🔒 | Active sessions + login/magic-link/2FA event log. |
| `DELETE` | `/users/me/sessions/{id}` | 🔒 | Revoke one session (device). |
| `DELETE` | `/users/me/sessions` | 🔒 | Revoke every other session (keeps the current one). |
| `GET` | `/users/me/trash` | 🔒 | Your soft-deleted posts. |
| `GET` | `/users/me/export` | 🔒 | Export your account data. |
| `POST` | `/users/me/pin/{post_id}` | 🔒 | Pin a post to your profile. |

## Relations — `/users/{username}/…`

| Method | Path | | Description |
|--------|------|--|-------------|
| `POST` / `DELETE` | `/users/{username}/block` | 🔒 | Block / unblock a user. |
| `POST` / `DELETE` | `/users/{username}/mute` | 🔒 | Mute / unmute a user. |
| `GET` | `/users/me/blocks` | 🔒 | Your block list. |
| `GET` | `/users/me/mutes` | 🔒 | Your mute list. |

## Feed & discovery

| Method | Path | | Description |
|--------|------|--|-------------|
| `GET` | `/feed` | 🔒 | Personal home (you + followees). |
| `GET` | `/feed/federated` | 🔓 | Federated explore timeline (remote ActivityPub posts this instance ingested). |
| `GET` | `/feed/videos` | 🔓 | Public posts carrying local video media. |
| `GET` | `/search?q=&tag=` | 🔓 | Meilisearch query (live + public only). |
| `GET` | `/hashtags/{tag}` | 🔓 | Posts for a hashtag. |
| `GET` | `/hashtags/{tag}/follow` | 🔓 | Whether the viewer follows the tag (`{following}`). |
| `POST` / `DELETE` | `/hashtags/{tag}/follow` | 🔒 | Follow / unfollow a topic (its public posts surface in `/feed`). |
| `GET` | `/trending/hashtags?window=` | 🔓 | Trending hashtags (`1h`/`24h`/`7d`). |
| `GET` | `/trending/posts?window=` | 🔓 | Trending posts. |
| `GET` | `/link_preview?url=` | 🔓 | SSRF-safe Open Graph unfurl (cached). |

## Social

| Method | Path | | Description |
|--------|------|--|-------------|
| `GET` | `/bookmarks` | 🔒 | Your bookmarks. |
| `POST` / `DELETE` | `/bookmarks/{post_id}` | 🔒 | Add / remove a bookmark. |
| `GET` | `/dm/threads` | 🔒 | DM thread list (+ last message, unread). |
| `GET` | `/dm/threads/{username}` | 🔒 | A conversation — messages carry media + aggregated reactions (mutual-follow required). |
| `POST` | `/dm/threads/{username}` | 🔒 | Send a message (`body` and/or `media_url` + `media_kind` `image`\|`video`). |
| `DELETE` | `/dm/threads/{username}` | 🔒 | Delete the conversation (per-user clear; other side unaffected). |
| `POST` | `/dm/threads/clear` | 🔒 | Bulk-delete conversations — `{ ids: [thread_id] }`. |
| `PATCH` | `/dm/threads/{username}/read` | 🔒 | Mark read. |
| `POST` | `/dm/threads/{username}/typing` | 🔒 | Ephemeral typing ping (SSE to recipient). |
| `POST` / `DELETE` | `/dm/messages/{id}/react` | 🔒 | Add / remove a message reaction — `{ emoji }`. |
| `DELETE` | `/dm/messages/{id}` | 🔒 | Delete one of your messages. |
| `POST` | `/dm/messages/delete` | 🔒 | Bulk-delete your messages — `{ ids: [message_id] }`. |
| `POST` | `/reports` | 🔒 | Report content (deduped). |

## Notifications & real-time

| Method | Path | | Description |
|--------|------|--|-------------|
| `GET` | `/notifications` | 🔒 | Notification inbox (paginated). |
| `GET` | `/notifications/count` | 🔒 | Unread count. |
| `GET` | `/notifications/stream` | 🔒 | **SSE** stream: notifications, typing, `new_post` firehose. |
| `PATCH` | `/notifications/read` | 🔒 | Mark all read. |
| `PATCH` | `/notifications/{id}/read` | 🔒 | Mark one read. |

## Media — `/media`

| Method | Path | | Description |
|--------|------|--|-------------|
| `POST` | `/media` | 🔒 | Upload an **image** (sniffed, EXIF-stripped, re-encoded, downscaled ≤2048 px, ≤12 MiB) or a **video** (mp4/webm/mov, stored verbatim, range-served, ≤64 MiB). |
| `DELETE` | `/media/{id}` | 🔒 | Delete an upload. |

## Invites — `/invites`

| Method | Path | | Description |
|--------|------|--|-------------|
| `POST` | `/invites` | 🔒 | Create an invite code (5/day, 14-day TTL). |
| `GET` | `/invites` | 🔒 | Your invite codes. |
| `GET` | `/invites/{code}` | 🔓 | Validate a code. |
| `DELETE` | `/invites/{code}` | 🔒 | Cancel an unused code. |

## Developer — tokens, webhooks, push

| Method | Path | | Description |
|--------|------|--|-------------|
| `GET` | `/tokens` | 🔒 | List your API tokens. |
| `POST` | `/tokens` | 🔒 | Create a scoped token (shown once). |
| `DELETE` | `/tokens/{id}` | 🔒 | Revoke a token. |
| `GET` | `/webhooks` | 🔒 | List webhook subscriptions. |
| `POST` | `/webhooks` | 🔒 | Create a webhook. |
| `PATCH` | `/webhooks/{id}` | 🔒 | Update a webhook. |
| `GET` | `/webhooks/{id}/deliveries` | 🔒 | Recent delivery log (last 20: event, status, ok, reason). |
| `POST` | `/webhooks/{id}/test` | 🔒 | Enqueue a signed test ping (rate-limited). |
| `GET` | `/push/vapid-public-key` | 🔓 | VAPID public key for Web Push. |
| `POST` | `/push/subscribe` | 🔒 | Register a push subscription. |
| `DELETE` | `/push/unsubscribe` | 🔒 | Remove a push subscription. |

### Example: publish from an external service

```bash
curl -X POST https://burncpu.com/api/v1/posts \
  -H "Authorization: Bearer $BURNCPU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body":"Yeni yazı yayında 🔥 https://mustafaerbay.com.tr/blog/...","visibility":"public"}'
```

## Admin — `/admin` 🛡️

Role `admin` **and** a 2FA-satisfied session required.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/stats` | Instance stats. |
| `GET` | `/admin/posts` · `PATCH /admin/posts/{id}` | Moderate posts. |
| `GET` | `/admin/users` · `PATCH /admin/users/{id}` | Moderate users. |
| `GET` | `/admin/audit` | Audit log. |
| `GET` | `/admin/login_attempts` | Login attempts. |
| `GET` | `/admin/sessions` | Active sessions. |
| `GET` | `/admin/moderation_log` | Moderation log. |
| `GET` | `/admin/reports` · `PATCH /admin/reports/{id}` | Triage reports. |

## Top-level (outside `/api/v1`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Liveness/readiness (Postgres + Redis; `503` if unhealthy). |
| `GET` | `/sitemap.xml` | Sitemap. |
| `GET` | `/embed/posts/{id}` | Embeddable post. |
| `GET` | `/rss/all` · `/rss/user/{u}` · `/rss/hashtag/{tag}` | Atom feeds. |
| `GET` | `/.well-known/webfinger` · `/nodeinfo/2.1` · `/ap/*` | ActivityPub federation. |

---

*Method/auth pairs are derived from the route modules in `src/routes/`. When
in doubt, the code is the source of truth.*
