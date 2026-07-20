# burncpu — mobil istemcisi

[English](README.md). Expo SDK 56 + expo-router ile React Native iOS/Android
istemcisidir ve `https://burncpu.com/api/v1` API'sini kullanır.

```bash
cd mobile
npm ci
npx expo start
npx tsc --noEmit
npm run lint
npm run test:e2e
```

Android APK sideload ve EAS iOS workflow'u vardır. Native Maestro akışları cihaz
veya EAS runner gerektirir; lokal ortamda cihaz yoksa CI'da çalıştırılmalıdır.
Native push, deep/universal link ve web ile ekran paritesi korunur.
