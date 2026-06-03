# burncpu — mobile (React Native / Expo)

Native iOS + Android client for [burncpu](https://burncpu.com), built with Expo
(SDK 56) + expo-router. The design is ported **1:1** from the web app: the same
Ember palette (`src/theme.ts` mirrors the web's `styles.css` tokens exactly),
Geist + Geist Mono, and the same screen structure.

It talks to the live production API (`https://burncpu.com/api/v1`) — no separate
backend. The session lives in the native cookie jar (set by magic-link verify),
exactly like the web's `burncpu_session` cookie.

## Run

```bash
cd mobile
npm install            # if node_modules isn't present
npx expo start         # then press i (iOS sim) / a (Android) / scan in Expo Go
```

- **iOS simulator:** `npx expo start --ios` (needs Xcode)
- **Android emulator:** `npx expo start --android` (needs Android Studio)
- **Physical device:** install **Expo Go**, scan the QR from `npx expo start`

### Native Android dev build

The flame logo + brand gradient use native modules (`react-native-svg`,
`@react-native-masked-view/masked-view`, `expo-linear-gradient`), so Android needs a
native build (Expo Go on iOS bundles them already). Gotchas learned the hard way:

```bash
cd android
# JBR lacks jmods → use a JDK that has them:
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
# build ONLY the emulator's ABI — a universal APK is ~240 MB and won't fit the
# emulator's data partition; arm64-v8a alone is ~85 MB:
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a
adb install -r app/build/outputs/apk/debug/app-debug.apk   # -r keeps the session
```

If a freshly-added Expo module reports *"Cannot find native module …"* after an
incremental build, the autolinking package list went stale — `rm -rf
android/app/build/generated` (or `./gradlew :app:assembleDebug --rerun-tasks`) and
rebuild, or avoid the module (see *Copy / share & files*).

Typecheck / bundle:

```bash
npx tsc --noEmit
npx expo export --platform ios   # validates the Metro bundle
```

## What's here (v1 foundation)

- **Theme** — `src/theme.ts`: exact dark/light Ember tokens + Geist fonts; live
  theme + language (tr/en) switch in Settings.
- **API/auth/i18n** — `src/api.ts`, `src/auth.ts` (global `useMe()`), `src/i18n.ts`.
- **Tabs** — Home, Search, Notifications, DMs, Profile (mirrors the web mobile nav).
- **Timeline** — Bana Özel / Global, infinite scroll, pull-to-refresh.
- **Post** — rich body (tappable links / @mentions / #hashtags / **bold**), embedded
  `![](media)` images, content-warning reveal, edited badge → edit history, reply /
  reaction (long-press 🐢 → emoji picker) / bookmark, and a "…" menu
  (edit + delete on your own posts, report on others').
- **Compose** — new post, **reply**, **edit**, image attach (→ `/media`), char count.
- **Profile** — self + others, follow/unfollow, tappable follower/following lists,
  **profile edit** (name, bio, avatar), and a "…" menu (mute / block / report).
- **DMs** — thread list + **conversation screen** (send, mark-read, bubbles).
- **Search** — live text search + **trending hashtags**; **hashtag feed** with follow.
- **Notifications** — All / Unread tabs + mark-all-read, tap-to-read.
- **Compose** — content-warning field + live **@-mention typeahead** (`/users/lookup`).
- **Search** — text search **+ a Trending hub** (24h/7d/30d windows, hashtag chips,
  trending posts).
- **Profile** — pinned-post slot + pin/unpin from a post's "…" menu.
- **Settings** — full **Security** (2FA enroll → authenticator deep-link + recovery
  codes + disable; session list with revoke + revoke-others + security-event log;
  passkeys), **Developer** (invites create/share/revoke, API tokens create/revoke),
  **Profile** (bookmarks, **Activity** analytics with SVG sparklines, **Trash** /
  restore), **Account** (data export via the share sheet, delete account).
- **Login** (+ **2FA challenge** step when a login leaves `pending_2fa`) and an
  **invite landing** screen (`/invite/[code]` → validate + prefill login).
- **Settings → Developer**: **Webhooks** (create/test/deliveries/delete) + an **API
  Docs** screen rendered from `/openapi.json`.
- **Admin** (role-gated): stats grid, open-reports queue + resolve, **federation
  instance blocklist** add/remove, user table + suspend.
- **DM typing indicator** — a tiny XHR-based SSE client (`src/sse.ts`,
  `/notifications/stream`) shows "typing…" and refetches when it stops; the composer
  sends throttled typing pings.
- **post detail + replies**, **Bookmarks**.

> Posts from `/users/{u}/posts` (no author), `/bookmarks` + `/hashtags/{tag}` (flat
> `author_*` fields) are normalized into the nested `author` shape `<Post>` needs —
> see `normalizePost` in `src/api.ts` and the owner-enrich in `ProfileView`.

## Copy / share & files

No `expo-clipboard` / `expo-file-system` / `expo-sharing` — to stay native-module-light
the app uses React Native core `Share` (`shareText` in `src/util.ts`) for invite links,
API tokens, 2FA secret/recovery codes and the data export, plus `selectable` text for
long-press copy. (Avoids autolinking churn on the existing dev build.)

## Auth on mobile

`POST /auth/request` (magic link) works today. To **complete** sign-in inside the
app, the magic link must open the app via a universal/app link — the route
`app/auth/verify/[token].tsx` then consumes the token and stores the session
cookie. That requires server-side association files (one-time):

- iOS: `https://burncpu.com/.well-known/apple-app-site-association` →
  `{"applinks":{"details":[{"appID":"<TEAMID>.com.burncpu.app","paths":["/auth/verify/*"]}]}}`
- Android: `https://burncpu.com/.well-known/assetlinks.json` with the app's SHA-256
  signing fingerprint.

`app.json` already declares `associatedDomains` + the Android intent filter.

## Requires a native dev build (not Expo Go)

These need `npx expo run:ios` / `eas build` (Expo Go can't load native modules or
remote push), plus a little backend/server work:

- **Push notifications** — `expo-notifications` for an APNs/FCM (or Expo) token;
  the backend `/push` currently expects a Web Push subscription, so it needs a
  mobile-token path. Expo Go dropped remote push, so this only runs in a dev build.
- **Native passkey sign-in** — `react-native-passkeys` (iOS ASAuthorization /
  Android Credential Manager) + the association files below.
- **Magic-link completion in-app** — the `auth/verify/[token]` route is wired and
  `app.json` declares `associatedDomains` + the Android intent filter; it activates
  once the server serves the one-time association files (see "Auth on mobile").
