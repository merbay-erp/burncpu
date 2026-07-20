# burncpu — web istemcisi

[English](README.md). SolidJS 1.9 + TypeScript 5.7 + Vite 6 + Tailwind 3.4 SPA'sı
nginx tarafından servis edilir. Geliştirmede `/api` istekleri canlı API'ye proxy
edilir; state-changing testler için disposable hesap kullanın.

```bash
cd web
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

Fontsource WOFF2 fontları bundle'a pinlidir; preload/CSS referansları ve Google
Fonts sızıntısı build kontrolünde doğrulanır. Route/component kapsamı için
English README ve [mimari](../ARCHITECTURE.tr.md) sayfasına bakın.
