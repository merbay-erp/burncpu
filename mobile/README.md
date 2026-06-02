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

- **Theme** — `src/theme.ts`: exact dark/light Ember tokens + Geist fonts.
- **API/auth/i18n** — `src/api.ts`, `src/auth.ts` (global `useMe()`), `src/i18n.ts` (tr/en).
- **Tabs** — Home, Search, Notifications, DMs, Profile (mirrors the web mobile nav).
- **Screens** — timeline (Bana Özel / Global), post detail + replies, profile
  (self + others, follow), search, notifications, DM thread list, compose, login.
- **Post** — author/handle/time, edited badge → edit-history, reactions (🐢) /
  reply / bookmark, content warnings.

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

## Next

- Native passkey sign-in (react-native-passkeys / Credential Manager).
- DM thread screen + send, push notifications (expo-notifications + the existing
  `/push` endpoints), media upload (expo-image-picker → `/media`), markdown render.
