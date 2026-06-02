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
- **Notifications**, **Bookmarks**, **Settings** (theme, language, 2FA/passkey/session
  summary, logout), **post detail + replies**, **login** (magic link).

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
