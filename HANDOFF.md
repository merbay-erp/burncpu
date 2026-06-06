# burncpu — Oturum Devir Notu (HANDOFF)

> Yeni bir Claude oturumu bu dosyayı okuyup **tam olarak kaldığımız yerden** devam edebilir.
> Tarih: 2026-06-03. Hazırlayan: önceki oturum.

---

## 0) TL;DR — nerede kaldık

- **Mobil uygulama: %100 bitti.** Web ile tam parite. `origin/main`'e push'landı (`942bfd2`). Prod'a değmez (`mobile/**` deploy-filtresi dışı).
- **Backend universal-link + push teslimatı (#33, #34): ✅ BİTTİ + DEPLOY EDİLDİ** (commit `e97666c`, origin/main, 2026-06-03).
  - `src/config.rs` (IOS_APP_ID + ANDROID_CERT_FINGERPRINTS), `src/routes/applinks.rs` (AASA + assetlinks), `routes/mod.rs`, `main.rs` (2 well-known route), `push.rs` (`send_to_device_tokens`), `notifications.rs` (notify() çağrısı) — hepsi commit'li.
  - `cargo check` temiz; "Deploy to VPS3" success (6m3s); healthz 200; iki `.well-known` route → 404 (env set DEĞİL = doğru davranış).
  - **KALAN tek iş = Bölüm 7 runbook (#35): hesap-gerektiren adımlar — MUSTAFA yapmalı** (env'e IOS_APP_ID/fingerprints + Expo push creds + store submit).

**Güncelleme (2026-06-03, 2. oturum) — özet:**
- **Android universal-link** ✅ AKTİF (assetlinks.json 200; `FA:C6` fingerprint prod `.env`).
- **Push (FCM)** ✅ kuruldu: `eas init` (projectId `3ad9565e-…`, commit `d513b92`), FCM V1 servis-hesabı anahtarı Expo'da (`@mustafaerbay/burncpu`), `google-services.json`+app.json (commit `9828f58`), `push.ts` Expo-token (commit `889bb3a`). **Release APK (FA:C6, FCM gömülü) build edildi → `https://burncpu.com/media/burncpu.apk`** (nginx statik). Emülatörde FirebaseInit ✅ çökmesiz. **Telefonda app KURULU; login askıda** (universal-link taze-kurulum async-verify sorunu).
- **OAuth sosyal login + açık kayıt** ✅ KODLANDI + DEPLOY (commit `a02abbf`): Google/GitHub/Microsoft, generic OAuth2 (state+PKCE) `/api/v1/oauth/*`, migration `0020 oauth_identities`, web+mobil dinamik butonlar. `INVITES_REQUIRED=false`. **Sağlayıcılar creds girilene kadar PASİF** (`/oauth/providers`→[]). Apple: paid dev gelince. → OAuth, app-login derdini de kökten çözer.

**Devam etmek için (KALAN tek iş):** Sağlayıcı OAuth app kayıtları (Mustafa hesapları, browser'dan Claude sürer):
- Google Cloud Console → OAuth consent + Client ID (web); GitHub → OAuth App; Microsoft → Azure app reg. Redirect URI hepsi: `https://burncpu.com/api/v1/oauth/{provider}/callback`.
- client_id/secret → prod `.env` (`GOOGLE_CLIENT_ID/SECRET`, `GITHUB_…`, `MICROSOFT_…`) → `cd /opt/burncpu && docker compose up -d --force-recreate app` → `/oauth/providers` dolar → web+mobil login test.

---

## 1) Proje + stack

- **burncpu** — Rust/Axum (edition 2024) + SolidJS sosyal medya app, prod: https://burncpu.com (vps3).
- Backend: Axum 0.8, sqlx/Postgres (runtime query_as + FromRow), redis, webauthn-rs, web-push (VAPID), reqwest 0.12.
- Web front: SolidJS + TS (Vite), Tailwind, CSS-variable "Ember" tokenları.
- **Mobil: React Native / Expo SDK 56** + expo-router (file-based, typedRoutes), `mobile/` dizini.
- Sahibi: Mustafa Erbay (@mustafa, Türkçe konuşur, "dostum" der). Türkçe yanıt ver.

## 2) Erişim + güvenlik kuralları (ÖNEMLİ)

- **SSH:** `ssh root@vps3` yetkili (prod). SSH banner'ını çıktıdan filtrele.
- **gh CLI:** prod deploy için yetkili.
- **Prod DB:** container `burncpu-pg`, user/db = `burncpu`. Çalıştırma:
  `printf "<SQL>" | ssh root@vps3 "docker exec -i burncpu-pg psql -U burncpu -d burncpu -q -v ON_ERROR_STOP=1"`
- **Sırlar gizli:** token/secret değerlerini ÇIKTIYA YAZMA (mint edip kullan, değeri sakla). `/opt/burncpu/.env` okurken sadece varlığı kontrol et, değerleri loglama.
- **Deploy:** `main`'e push → self-hosted CI "Deploy to VPS3" (`/usr/local/bin/deploy-burncpu.sh`). Path filtreleri: `src/**`, `web/**`, `Cargo.toml`, `Cargo.lock`, `Dockerfile`, `migrations/**`, `.github/workflows/deploy.yml`. **`mobile/**` deploy TETİKLEMEZ.**
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Deploy doğrulama: healthz 200 + (varsa) migration `_sqlx_migrations`'da + route auth (401) + gerekiyorsa prod'da `BEGIN…ROLLBACK` dry-run.

## 3) Repo durumu

- Worktree: `/Users/mustafaerbay/IdeaProjects/burncpu/.claude/worktrees/elegant-meitner-5cd2dc`
- Branch `claude/elegant-meitner-5cd2dc`, upstream = `origin/main`. `git push origin HEAD:main` ile main'e gider.
- **Bugünkü commit'ler (hepsi push'lu, sadece mobil — prod'a değmedi):**
  - `026372e` — 11 polish özelliği + boş-gönderi-listesi bug fix
  - `70fd417` — son 6 parite özelliği (2FA challenge, webhooks, admin, invite landing, docs, DM typing)
  - `942bfd2` — Ember alev app ikonu + splash + eas.json + temizlik + fmtNum
- **Uncommitted (bu oturumda başlanan backend işi):** `src/config.rs` (düzenlendi), `src/routes/applinks.rs` (yeni). Henüz commit/deploy YOK.
- `.claude/` ve `mobile/assets/images/.orig-bak/` commit'lenmez (gitignore / worktree metadata).

## 4) Mobil uygulama — BİTTİ (referans)

Tam web↔mobil parite. `mobile/src/app/` (expo-router) ekranları:
- Tabs: index (timeline Bana Özel/Global), search (**Trending hub** 24s/7g/30g + etiketler + gönderiler), notifications (**Tümü/Okunmamış + tümünü-okundu**), dms, profile.
- Post (rich text, medya, CW, edit-history, reactions+emoji sheet, **pin/unpin**, …menü), compose (**CW alanı + @-mention typeahead**, medya, reply, edit).
- Profile/ProfileView (**pinned slot**, follow/mute/block/report), follows, u/[username], post/[id], tag/[tag], bookmarks.
- login (+ **/2fa challenge** akışı), invite/[code] (**davet-landing**), auth/verify/[token] (deep-link login).
- settings + alt ekranlar: **settings/twofa** (kurulum+kurtarma+disable), **settings/sessions** (revoke+events), **settings/invites**, **settings/tokens**, **settings/webhooks** (CRUD+test+deliveries), trash, activity (SVG sparkline), **admin** (stats/reports/federation/users, role-gated), docs (openapi).
- DM thread: **yazıyor… göstergesi** — `src/sse.ts` (bağımlısız XHR-SSE, `/notifications/stream`).

**Mimari kararlar:**
- Native-modül-light: kopya/paylaş = RN çekirdek `Share` (`shareText` in `util.ts`) + `selectable` metin. **expo-clipboard/file-system/sharing KULLANILMADI** (autolinking kırılganlığı + gradle cache sorunu yüzünden). SSE de XHR ile (bağımlısız).
- `normalizePost` (api.ts) + ProfileView owner-enrich: profil/bookmarks/hashtag gönderileri `<Post>`'un beklediği nested `author`'a normalize edilir (bunlar flat/author'suz döner; hashtag = Meilisearch `{hits}`).
- `fmtNum` (util.ts): Hermes-güvenli binlik ayırıcı.
- Ember ikonları `assets/images/*.png` (rsvg-convert ile alev SVG'den) + `app.json`. android mipmap'leri gitignore (`/android`), `eas build`/`expo prebuild` PNG'lerden yeniden üretir.

## 5) Mobil build / çalıştırma / login PLAYBOOK (tuzaklar)

- **iOS:** Expo Go (iPhone 17 Pro sim, UDID `2FEC0ECF-6E60-4446-8DFE-8EEE4DF92D75`). iOS native build disk-bloke (8.5GB sim platform).
- **Android native dev build** (alev logosu için react-native-svg/masked-view/linear-gradient native gerekiyor):
  ```bash
  cd mobile/android
  export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"   # JBR'de jmods YOK; bu JDK'da var
  export ANDROID_HOME="$HOME/Library/Android/sdk"; export PATH="$ANDROID_HOME/platform-tools:$PATH"
  export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
  ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain   # SADECE arm64 (~86MB; universal 238MB emülatöre sığmaz)
  adb install -r app/build/outputs/apk/debug/app-debug.apk   # space yetmezse: adb uninstall com.burncpu.app && adb install ...
  ```
  - Yeni Expo modülü ekleyip "Cannot find native module" alırsan: `rm -rf mobile/android/app/build/generated` + rebuild (autolinking paket listesi bayatlıyor).
  - Emülatör data partition'ı ~%93 dolu; `install -r` çoğu zaman yer bulamaz → `adb uninstall` gerekir (oturumu siler → tekrar login). **Mustafa'nın diğer projeleri de kurulu (seray.erp, hesaplayicilar, sizbiz, gorevler...) — ONLARI SİLME.**
- **Metro:** `cd mobile && npx expo start --dev-client --port 8081` (önceki oturumda task `bx8hg4pmc` ile çalışıyordu).
- **Mustafa'yı login yap** (magic-link token mint + deep-link, TOKEN'i çıktıya yazma):
  ```bash
  TOKEN=$(openssl rand -hex 32)
  printf "INSERT INTO auth_tokens (token_hash, email, expires_at) SELECT digest('%s','sha256'), email, NOW()+interval '15 minutes' FROM users WHERE username='mustafa';\n" "$TOKEN" \
    | ssh root@vps3 "docker exec -i burncpu-pg psql -U burncpu -d burncpu -q -v ON_ERROR_STOP=1"
  adb shell am start -W -a android.intent.action.VIEW -d "burncpu://auth/verify/$TOKEN" com.burncpu.app >/dev/null 2>&1   # çıktıyı bastır (URI'de token var)
  # doğrula (token'ı göstermeden): consumed_at + son 4dk session sayısı
  ```
  - `hash_token = Sha256::digest` (src/auth/mod.rs:33) ↔ pgcrypto `digest(x,'sha256')`. `auth_tokens`: token_hash BYTEA PK, email CITEXT, expires_at, consumed_at, ip INET?, user_agent. Zorunlu: token_hash, email, expires_at.
  - iOS Expo Go deep-link: `exp://127.0.0.1:8082/--/auth/verify/<token>`.
- **Ekran görüntüsü:** `adb exec-out screencap -p > /tmp/x.png` (Android) / `xcrun simctl io booted screenshot` (iOS). **DİKKAT:** önceki oturumda sohbet-içi görüntü okuma BÜTÇESİ TÜKENDİ (her boyut reddedildi). Doğrulamayı Metro log (hata yok) + logcat (`adb logcat -d -t 400 | grep -iE "ReactNativeJS.*Error|FATAL"`) + API/DB ile yap. Yeni oturumda görüntü tekrar çalışabilir — dene; çalışmazsa log-tabanlı doğrula.
- mustafa: role=**admin** (admin paneli test edilebilir). `Me` tipinde `role` var → admin girişi `me.role==='admin'` ile gate'li.

## 6) BACKEND İŞİ — ✅ BİTTİ + DEPLOY EDİLDİ (commit `e97666c`)

> Aşağıdaki 4 düzenleme uygulandı, `cargo check` temiz geçti, commit + push (origin/main) + deploy edildi (2026-06-03). Bölüm referans/kayıt amaçlı tutuluyor.

Amaç: (A) universal-link association dosyaları, (B) Expo push teslimatı. `src/config.rs` + `src/routes/applinks.rs` ZATEN yapıldı. Kalanlar:

### Edit 1 — `src/routes/mod.rs`: modülü ekle
`pub mod api;`'den sonra (alfabetik) ekle:
```rust
pub mod applinks;
```

### Edit 2 — `src/main.rs` (~satır 115): route'ları root'a kaydet
`.route("/nodeinfo/2.1", get(routes::federation::nodeinfo))`'dan SONRA, `.nest("/ap", ...)`'tan ÖNCE ekle:
```rust
        .route(
            "/.well-known/apple-app-site-association",
            get(routes::applinks::apple_app_site_association),
        )
        .route(
            "/.well-known/assetlinks.json",
            get(routes::applinks::android_assetlinks),
        )
```

### Edit 3 — `src/routes/push.rs`: Expo push teslimat fonksiyonu ekle
`send_to_user` fonksiyonunun yanına (dosya sonuna) ekle. (push.rs zaten `AppState` + `Uuid` import ediyor.)
```rust
/// Fan a notification out to the user's registered Expo push tokens via Expo's
/// push service (which routes to APNs/FCM). No-op until the mobile app produces
/// real ExponentPushTokens (needs app.json `extra.eas.projectId` + a dev/standalone
/// build) and the Expo project has FCM/APNs creds. Raw FCM/APNs tokens are skipped.
pub async fn send_to_device_tokens(
    state: &AppState,
    user_id: Uuid,
    kind: &str,
    actor_username: Option<&str>,
    target_kind: &str,
    target_id: Uuid,
) {
    let tokens: Vec<String> =
        sqlx::query_scalar("SELECT token FROM device_push_tokens WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(&state.pg)
            .await
            .unwrap_or_default();
    let expo: Vec<String> = tokens
        .into_iter()
        .filter(|t| t.starts_with("ExponentPushToken") || t.starts_with("ExpoPushToken"))
        .collect();
    if expo.is_empty() {
        return;
    }
    let who = actor_username.unwrap_or("biri");
    let title = match kind {
        "reaction" => format!("@{who} postuna tepki verdi"),
        "reply" => format!("@{who} yanıt verdi"),
        "follow" => format!("@{who} seni takip etti"),
        "mention" => format!("@{who} seni bahsetti"),
        "dm" => format!("@{who} mesaj attı"),
        _ => format!("@{who} → {kind}"),
    };
    let url = if target_kind == "post" {
        format!("/posts/{target_id}")
    } else if target_kind == "thread" {
        "/dm".to_string()
    } else {
        "/notifications".to_string()
    };
    let messages: Vec<serde_json::Value> = expo
        .iter()
        .map(|t| {
            serde_json::json!({
                "to": t, "title": title, "body": "burncpu",
                "sound": "default", "priority": "high", "channelId": "default",
                "data": { "url": url, "kind": kind },
            })
        })
        .collect();
    let client = reqwest::Client::new();
    if let Err(e) = client
        .post("https://exp.host/--/api/v2/push/send")
        .json(&messages)
        .send()
        .await
    {
        tracing::warn!(?e, "expo push send failed");
    }
}
```

### Edit 4 — `src/routes/notifications.rs` (~satır 312): notify()'de çağır
`crate::routes::push::send_to_user( ... ).await;` çağrısından SONRA ekle:
```rust
    crate::routes::push::send_to_device_tokens(
        state,
        user_id,
        kind,
        actor_username_clone.as_deref(),
        target_kind,
        target_id,
    )
    .await;
```
> NOT: `actor_username_clone` notify() içinde mevcut (send_to_user ondan `.as_deref()` ile kullanıyor). Eğer borrow-checker şikâyet ederse send_to_user çağrısıyla aynı deseni kullan.

### Sonra: derle → commit → deploy → doğrula
```bash
cargo check                      # derleme hatalarını yakala (deploy Docker'da build eder; önce burada doğrula)
git add src/ && git commit -F - <<'EOF'
backend: universal-link association files + Expo push delivery

- GET /.well-known/apple-app-site-association + /assetlinks.json served at root,
  env-driven (IOS_APP_ID, ANDROID_CERT_FINGERPRINTS); 404 when unset.
- send_to_device_tokens(): fan notifications to Expo push tokens via exp.host,
  called from notify() alongside web-push.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
git push origin HEAD:main       # src/** → "Deploy to VPS3" tetiklenir
# CI bitince doğrula:
gh run list --limit 3
curl -s -o /dev/null -w "%{http_code}\n" https://burncpu.com/healthz                       # 200
curl -s -o /dev/null -w "%{http_code}\n" https://burncpu.com/.well-known/assetlinks.json    # env set DEĞİLSE 404 (BEKLENEN/DOĞRU)
```
İki `.well-known` route'u, env değerleri girilene kadar **404 döner — bu doğru davranış** (sahibi olduğumuzu kanıtlayamadığımız association'ı servis etmeyiz).

## 7) Hesap-gerektiren adımlar — bunları MUSTAFA yapmalı (#35 runbook)

Kod hazır; aktifleşmesi için sen (Mustafa) şunları yap:

> **Android ✅ YAPILDI** (2026-06-03): `.env`'e `ANDROID_CERT_FINGERPRINTS=FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C` eklendi (lokal/debug keystore; `build.gradle`'da release de aynı anahtarla imzalı). `/.well-known/assetlinks.json` → 200 + doğru JSON doğrulandı. **iOS kısmı (IOS_APP_ID) hâlâ bekliyor.**
> ⚠️ **DÜZELTME:** app container `compose.yml`'de `env_file:` ile create-time env okur → düz `docker restart` yeni `.env`'i ALMAZ. Doğrusu: `cd /opt/burncpu && docker compose up -d --force-recreate app`.

**A) Universal-link'i aktive et** — `/opt/burncpu/.env`'e ekle + `cd /opt/burncpu && docker compose up -d --force-recreate app`:
- `IOS_APP_ID=<AppleTeamID>.com.burncpu.app`  (örn. `ABCDE12345.com.burncpu.app`; Team ID Apple Developer hesabından)
- `ANDROID_CERT_FINGERPRINTS=<SHA256>`  (virgülle debug+prod; `cd mobile && eas credentials` veya `keytool -list -v -keystore <ks>` → SHA-256, iki-nokta-ayraçlı hex)
- Doğrula: `curl https://burncpu.com/.well-known/apple-app-site-association` ve `/assetlinks.json` → 200 + doğru JSON.
- Sonra magic-link e-postadaki `https://burncpu.com/auth/verify/<token>` linki app'i AÇAR (artık manuel token mint gerekmez).

**B) Push'u aktive et** (Expo):
1. `cd mobile && eas init` → `app.json`'a `extra.eas.projectId` ekler (commit et).
2. ✅ YAPILDI — `mobile/src/push.ts` artık `getExpoPushTokenAsync({ projectId })` kullanıyor (projectId `app.json` `extra.eas.projectId`'den; yoksa no-op). commit `889bb3a`.
3. Expo projesine push creds yükle: Android için FCM v1 (google-services), iOS için APNs key — `eas credentials` ile.
4. dev/standalone build (`eas build -p android --profile preview`) → gerçek ExponentPushToken üretir → `/push/device`'a kaydolur → `send_to_device_tokens` teslim eder.

**C) Store'a hazırla / yayınla:**
1. `cd mobile && eas build -p android --profile preview` (APK, internal test) veya `--profile production` (aab).
2. iOS: `eas build -p ios --profile production` (Apple Developer hesabı gerekir).
3. `eas submit -p android` / `-p ios` (Google Play / App Store hesapları).
- `eas.json` zaten hazır (development/preview/production profilleri). `app.json`: bundleId `com.burncpu.app`, scheme `burncpu`, associatedDomains + Android intentFilters (/auth/verify) zaten tanımlı.

## 8) Açık not / uyarılar

- **Görüntü okuma bütçesi** önceki oturumda tükendi (her ekran görüntüsü reddedildi). Yeni oturumda tekrar dene; çalışmazsa log/DB ile doğrula.
- **Emülatör depolama** dar — native reinstall çoğu zaman uninstall (→ relogin) gerektirir. Mustafa'nın diğer app'lerini silme.
- `device_push_tokens` tablosu: `id, user_id, token, platform, created_at` (migration 0019).
- Bilinçli ertelenenler (telefonda düşük değer): yok — tüm parite kapandı. Geriye sadece bu Bölüm 7 hesap-adımları kaldı.

---
**Devam komutu (yeni oturumda):** "HANDOFF.md'yi oku, Bölüm 6'daki 4 düzenlemeyi bitir, cargo check + commit + push + doğrula, sonra durumu özetle."
