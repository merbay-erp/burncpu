# burncpu — web

The SolidJS frontend. A small, reactive SPA served by nginx in production and
proxied to the live API in development.

> Part of [burncpu](../README.md). For the system design see
> [ARCHITECTURE.md → Frontend](../ARCHITECTURE.md#10-frontend-architecture).

## Stack

- **[SolidJS](https://www.solidjs.com/) 1.9** + `@solidjs/router`
- **TypeScript 5.7** (`noUnusedLocals` / `noUnusedParameters` on)
- **Vite 6** (build target `es2022`)
- **Tailwind 3.4** via CSS-variable tokens + `@tailwindcss/forms`
- `qrcode` (2FA enrollment) plus pinned Fontsource variable fonts; the full
  dependency and license graph lives in `package-lock.json`.

No component library, no state-management library, no CSS framework beyond
Tailwind. Solid's fine-grained reactivity does the work.

## Develop

```bash
npm ci
npm run dev      # http://localhost:5173
```

The dev server **proxies `/api` → https://burncpu.com** (see
`vite.config.ts`), so you can build and test the UI against the live API
**without running the backend locally**. Treat this as a read-mostly preview:
state-changing actions affect the real service; use the pinned local stack and
test fixtures for destructive or authenticated development.

To act as a logged-in user during local testing, the app reads a session
cookie; against prod you'll be anonymous unless you sign in. (Internally we
also fake auth in a headless preview via `setCachedMe(...)` from `auth.ts`.)

```bash
npm run build    # tsc -b && vite build + font verification → dist/
npm run preview  # serve the production build on :4173
npm test         # Vitest unit/regression tests
npm run test:e2e # Playwright desktop + mobile viewport flows
```

Fontsource's pinned OFL-1.1 Geist, Geist Mono and Material Symbols packages
are bundled into same-origin WOFF2 assets. The production build injects critical
font preloads and `npm run verify:font-assets` checks license metadata,
`font-display: swap`, preload files and absence of Google font URLs.

## Structure

```
src/
├── main.tsx          Router + route table (lazy-loaded pages)
├── Layout.tsx        Root shell: top nav, sidebars, bottom nav, overlays, SSE
├── api.ts            fetch wrapper (/api/v1, credentials: include) + types
├── auth.ts           session probe, me() signal, unread count
├── i18n.ts           flat t(key) dictionary (TR/EN)
├── theme.ts          dark/light toggle (+ no-flash inline script in index.html)
├── styles.css        Ember tokens, animations (keyframes), scrollbar
├── util.ts           url helpers, linkify, relative time
├── pages/            one component per route (23)
└── components/       shared Post, Avatar, Compose, CommandPalette, LinkCard,
                      EmojiPicker, Skeleton, AuthGate, Toast, Lightbox, … (21)
```

## Conventions

- **Styling** — only Tailwind utilities + CSS-variable tokens,
  `rgb(var(--c-NAME) / <alpha-value>)`. Never hard-code colors. Dark is the
  default; light is `html.light`. The **Ember** palette (warm charcoal /
  cream) lives in `styles.css`; font is Geist Mono.
- **i18n** — every user-facing string is a `t('key')` with **both** `tr` and
  `en` entries in `i18n.ts`. No bare literals in JSX.
- **API** — call through `api.{get,post,patch,del}` from `api.ts`; add the
  response shape to its `interface`s.
- **Reuse primitives** — `<Post>`, `<Avatar>`, `<Skeleton>`, `<AuthGate>`,
  `<LinkCard>`, `InfiniteList`. The **synthesize-PostView** pattern turns lean
  rows into a `PostView` so every list reuses `<Post>` (reactions, link
  previews, menus) instead of bespoke cards.
- **Real-time** — `Layout` holds the single SSE connection and re-broadcasts
  as DOM `CustomEvent`s (`burncpu:posted`, `burncpu:newpost`,
  `burncpu:typing`, `burncpu:notification`); pages subscribe.
- **TypeScript** — unused locals/imports fail the build. Keep imports tight.

## Before you push a UI change

- ✅ `npx tsc -b` and `npm run build` clean
- ✅ Looks right in **light and dark** themes
- ✅ No horizontal overflow at mobile width (≈390px)
- ✅ No console errors

## Build & deploy

`npm run build` emits hashed assets to `dist/`. In production these are
served by nginx; deployment happens automatically when changes land on
`main` (see [ARCHITECTURE.md → Deployment](../ARCHITECTURE.md#deployment--ci)).
A deploy is verified by matching the live `index-*.js` hash to the local
build.
