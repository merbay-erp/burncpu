# burncpu — 100k-Ölçek Denetimi

🇬🇧 [English summary](AUDIT-100K.md)

> Tarihsel snapshot: 2026-06-08. Kapsam: scalability (tek VPS, 100k kullanıcı) +
> üst-düzey güvenlik + otonom moderasyon + correctness. Bu dosya ilk salt-okunur
> kapasite incelemesinin kanıt arşividir; güncel üretim kararı için
> [14 Temmuz canlı denetim raporuna](AUDIT-2026-07-14.md) bakın.

> **Durum yenilemesi — 2026-07-20:** Sonraki migration'lar ve düzeltme paketleri
> sayaç/index/partition/trending, moderasyon eskalasyonu, federation güvenliği,
> E2E, yük kapıları ve CI bulgularının önemli bölümünü kapattı. Aşağıdaki
> “önce yapılmalı” listesi tarihsel önceliklendirmeyi korur; otomatik olarak
> güncel backlog kabul edilmemelidir.

## Genel hüküm (08 Haziran 2026 snapshot'ı)

| Boyut | Durum |
|---|---|
| **Güvenlik** | 🟢 **Mükemmel.** Critical/High **YOK**. Zor olan her şey (SSRF, federation imza doğrulama, sanitizer, secret-at-rest, IDOR/visibility, SQL parametrizasyon) **doğru ve defansif** yapılmış. Sadece 2 MEDIUM + birkaç LOW (defense-in-depth). |
| **Correctness** | 🟢 **Yüksek bar.** Kullanıcı-girdisiyle çökme **yok**, sayaçlar çoğu atomik/recount, çok-adımlı yazımlar transaction'lı. Birkaç MEDIUM (aşağıda). |
| **Scale (100k)** | 🟠 **İş var.** Darboğazlar: (1) Postgres tune edilmemiş, (2) her istekte yazma amplifikasyonu, (3) okuma cache'i yok. Hepsi çözülebilir. |
| **Moderasyon** | 🔴 **~%30 otonom.** O tarihte yalnız yeni-hesap quarantine vardı; güncel sistemde heat, domain reputation, report threshold, shadow-ban, appeals ve hash-blocklist katmanları da bulunuyor. |

**Ops bağlamı:** VPS 18 çekirdek / 94GB RAM / 678GB disk — donanım 100k için fazlasıyla yeter; ama log5651 ile **paylaşımlı** (izolasyon gerekli). Mevcut ölçek minik (318 post). Yani bu, 100k'ya **hazırlık** denetimi.

### Güncel açık sınırlar

- Tek VPS ve tek admin hâlâ bilinçli operasyon modelidir; yatay ölçek ve
  ayrıntılı RBAC hedef değildir.
- Origin-served media için CDN yoktur; upload ve transcode sınırları vardır.
- Learned AI/ML sınıflandırması yoktur; üretim heuristik ve insan itirazı ile
  çalışır.
- 10k SSE/HTTP profili izole CI/local ortamda koşar; üretim domain'ine yük
  gönderilmez.

---

## 🎯 100k'dan ÖNCE yapılması ZORUNLU (öncelik sırası)

1. **Postgres tuning (T1)** — sıfır kod, en yüksek getiri. `shared_buffers 128MB→6GB`, `work_mem 4MB→32MB`, `effective_cache_size→16GB`, `max_wal_size→8GB`, `maintenance_work_mem→1GB`, `random_page_cost→1.1`.
2. **Her-istek yazma amplifikasyonunu öldür:**
   - **W2** `session.rs:185` — her authenticated istekte `UPDATE sessions SET last_seen`. 60sn'ye throttle et (API-token yolu zaten yapıyor, cookie yolu unutulmuş).
   - **W1** `audit/middleware.rs:62` — her istekte `INSERT audit_log`. Sample (sadece mutating + 4xx/5xx), batch, veya ClickHouse/Loki'ye taşı + ay-bazlı partition.
3. **Okuma cache'i (C1)** — public timeline / feed / trending Redis'te cache'lenmiyor; her istek PG'ye gidiyor. 15-30sn TTL + **stampede-lock** (`SET NX EX 5`). En büyük kazanç.
4. **Feed/timeline sorgu düzeltmeleri (Q1/Q2):** per-row `EXISTS` (reactions/bookmarks) → tek batch `LEFT JOIN`; public-timeline partial index'e `reply_to_id IS NULL` + `id` ekle.
5. **Trending precompute (Q3):** her istekte tüm public gövdeleri regex'liyor; `post_hashtags` tablosu (0024) varken kullanmıyor. Saatlik precompute + ZSET; `window`'u ≤168h clamp et.
6. **Yüksek-churn tabloları partition'la (W3):** `audit_log`/`login_attempts`/`notifications` ay-bazlı → retention = `DROP PARTITION` (dev DELETE yerine).
7. **Moderasyon P0+P1:** otomatik quarantine'i `moderation_log`'a yaz + `spam_score`'u doldur (şu an NULL); rapor-eşiği otomatik aksiyonu ekle.

---

## 1) Scalability — 100k / tek VPS

### CRITICAL
- **T1 — Postgres default ayarlarda** (94GB kutuda `shared_buffers=128MB`). Milyonlarca post'ta working-set cache'lenmez, feed sorguları disk'e taşar. → yukarıdaki değerler.
- **W1 — Her istekte `audit_log` INSERT** (`middleware/audit.rs:62`). 2000 req/s = 2000 INSERT/s × 4 index, 90 gün retention → DB'nin en büyük tablosu, dev DELETE'ler. Sample + batch + partition.
- **W2 — Her authenticated istekte `UPDATE sessions`** (`session.rs:185`). Hot-row write/lock/WAL per istek. → 60sn throttle (`WHERE last_seen_at < NOW()-interval '60s'`) veya Redis'e taşı.
- **Q1 — Home feed fan-out-on-read** (`feed.rs:63`): per-row 2× `EXISTS` + `author_id IN (SELECT follows)` + hashtag EXISTS + 3-way block UNION. ~1K followee/100K post'ta bükülüyor (kod yorumu da kabul ediyor). → cache (C1) → batch viewer-state → en sonda fan-out-on-write (`feed_entries` tablosu).
- **Q2 — Public timeline** (`posts.rs:569`): partial index `reply_to_id IS NULL`'ı kapsamıyor (reply'ları tarayıp atıyor). → index düzelt + cache (anonim için aynı içerik).
- **Q3 — Trending full regex scan** (`trending.rs:70`): her istekte son-24h tüm public post'ları regex'liyor; `?window=8760h` ile tüm korpus. → `post_hashtags` + precompute.

### HIGH
- **C1 — Hiçbir okuma cache'i yok** (sadece link_preview). Stampede-lock şart.
- **Q4 — DM thread listesi** (`dm.rs:76`): thread başına 4 korelasyonlu subquery + `split_part`-üzerinden indekslenemez media JOIN. → `dm_threads`'e last_message denormalize; `dm_messages`'a `media_id` FK.
- **W3 — Cleanup tek-seferde tüm-aralık DELETE** (`cleanup.rs:42`). → partition + batch.
- **P1 — sqlx pool=16, tek multiplexed Redis** (`db.rs:8`). Yavaş sorgular düzelmeden 16 yetmez → acquire-timeout çığı. → yavaşları düzelt, sonra 24-32 + PgBouncer; Redis için küçük pool.
- **Q5 — Profil görüntüleme 3× COUNT(\*) + 4 EXISTS** (`users.rs:539`). Celebrity (500k follower) her görüntülemede tarıyor. → `users`'a `followers_count`/`following_count`/`posts_count` denormalize.

### MEDIUM
- **M1** counter recount (`posts.rs:1079`): her react'te tüm post reaksiyonlarını COUNT ediyor → O(n²). Delta'ya geç (`+1/-1`).
- **M2** indekssiz FK'ler: `posts.repost_of_id`, `notifications.actor_id`, `reports.resolved_by`, `invites.redeemed_by`, `users.invited_by/pinned_post_id`. → btree index ekle.
- **M4** search drift: Meili index'leme fire-and-forget, retry/reconcile yok, reindex 50k cap. → outbox/retry + nightly reconcile.

### İzolasyon (paylaşımlı VPS)
cgroup `MemoryMax`: PG (work_mem×max_connections sınırı), Redis (256MB→512MB-1GB ama cap'li), **Meili (uncapped! 4GB cap)**, ffmpeg (`nice`/cpu-quota). Her container (burncpu + log5651) explicit CPU/mem kotası.

### Zaten iyi (dokunma)
Keyset pagination (OFFSET yok), webhook/transcode worker'ları bounded (channel+semaphore), search Meili (FTS PG'de değil), rate-limit Redis, pool explicit set + headroom, `post_hashtags` materialized index.

---

## 2) Güvenlik — üst-düzey

**Hüküm: Critical/High YOK.** Zor yüzeyler doğru. Bulgular defense-in-depth.

### MEDIUM
- **Forwarded-header IP güveni** (`middleware/client_ip.rs:18`): `CF-Connecting-IP`/`X-Forwarded-For` koşulsuz güveniliyor; nginx force-override etmiyorsa saldırgan header rotate edip **tüm per-IP rate-limit'leri bypass** eder (login brute-force, anon link-preview, post cap). Mitigasyon: app `127.0.0.1` bind. → `TRUSTED_PROXY` gate; nginx'in `$remote_addr` ile overwrite ettiğini DOĞRULA (CSP/nginx repo dışı, host'ta teyit et).
- **İç hata detayı sızıyor** (`errors.rs:35,51`): `AppError::Internal(anyhow)` → `to_string()` client'a JSON'da gidiyor (`internal: pkcs8: ...`). → Internal/Database/Redis için statik mesaj, detay sadece server log'da. `BadRequest(format!("...{e}"))` yerlerini de temizle.

### LOW
- Magic-link enumeration timing (`auth.rs:103`) — invited/known vs unknown e-posta SMTP-gecikme farkı (INVITES_REQUIRED=true'da). Açık kayıtta etki düşük.
- OAuth e-posta auto-link onaysız (`oauth.rs:285`) — Google/GitHub/MS için güvenli (verified email kontrollü); 4. zayıf sağlayıcı eklenirse takeover yolu olur. → pre-existing hesaba link'te onay adımı.
- Federation/SSRF red sebepleri caller'a echo'lanıyor (`federation.rs:338`, `webhooks.rs:94`) — probing kolaylaştırır. → generic 400.
- `is_host_blocked` fail-open (`federation/mod.rs:403`) — DB hatasında defederasyon geçici açılır. Kasıtlı; block için fail-closed düşün.

### Zaten DOĞRU yapılmış (teyitli)
**Passwordless** (şifre saklanmıyor); token'lar 256-bit CSPRNG + sadece SHA-256 hash saklı, magic-link atomik tek-kullanım; session HttpOnly+SameSite+Secure, suspended kontrolü; **TOTP XChaCha20 şifreli at-rest**, constant-time, replay-koruması, recovery atomik tek-kullanım; passkey challenge Redis tek-kullanım; OAuth state+PKCE + sadece verified email + mobil 60sn exchange-code. **CSRF** origin-allowlist tüm state-değiştiren route'larda. **IDOR yok** (her yerde `user_id=$self`); visibility/block tutarlı 15+ surface'te. **SQLi yok** (her şey `.bind()`). **SSRF guard mükemmel** (`net_safety.rs`: scheme/credential/private-IP/IPv6-mapped/NAT64 + DNS-pin rebinding'e karşı + redirect kapalı); her outbound fetch geçiyor; Web Push hardcoded allowlist. **Webhook** secret XChaCha20 şifreli + HMAC imzalı. **Federation** inbound imza GERÇEKTEN doğrulanıyor (keyId↔actor same-origin, digest zorunlu, 5dk replay penceresi). **XSS yok** (ammonia allowlist, `<img>` sadece local `/media/`, SVG yok). **Upload** byte-sniff + decode+re-encode (EXIF/bomb temiz), SVG reddediliyor, video ffmpeg `args` (shell yok). **Secrets** env'de, console-email prod'da fail-close, audit magic-link redact'liyor.

---

## 3) Moderasyon — bugün ~%30 otonom

**Tek otomatik aksiyon:** yeni-hesap spam quarantine (`posts.rs:192`, spam_score≥4 → quarantine). Gerisi (rapor→aksiyon, suspend, post kaldırma, federation block, image safety, repeat-offender) **%100 manuel**.

### 100k'da nerede kırılır
1. **Rapor kuyruğu triage'sız** (`admin.rs:679`): düz 200-satır liste, "kaç farklı kişi raporladı" sinyali yok, brigade ile tek meşru rapor aynı görünüyor.
2. **Quarantine kuyruğunda SLA yok** — signup dalgasında meşru kullanıcılar saatlerce görünmez kalır.
3. **Cross-post/velocity tespiti yok** — 50 sahte hesaptan 50 benzer post hiçbir şeyi tetiklemez (sadece künt per-user sayaç).
4. **Repeat-offender eskalasyonu yok** — bilinen kötü hesap, biri suspend edene dek tam bütçeli.
5. **Trending oynanabilir** (`trending.rs:109`): anti-sockpuppet ağırlık yok, viewer-block filtresi yok.
6. **Image/video moderasyonu HİÇ yok** — 100k UGC'de yasal/T&S riski.

### Roadmap (öncelikli)
- **P0 (S, ~0.5g)** — Var olanı gözlemlenebilir yap: `spam_score` kolonunu doldur + otomatik quarantine'i `moderation_log`'a `actor_kind='ai'` yaz (şu an audit izi YOK). *Her şeyin önkoşulu.*
- **P1 (M, ~2-3g)** — **Rapor-eşiği otomatik quarantine:** N farklı "güvenilir" raporcu → otomatik quarantine + `moderation_log`. En yüksek getiri. Partial index `reports(target_kind,target_id) WHERE resolved_at IS NULL`.
- **P2 (M, ~3g)** — Hesap-bazlı davranış skoru + dinamik rate-limit eskalasyonu (Redis "heat").
- **P3 (M, ~2g)** — Link/domain reputation + blocklist (`domain_reputation` tablosu).
- **P4 (S-M, ~2g)** — Shadow-ban (`moderation_state='shadow'`) — sessiz containment.
- **P5 (M-L)** — **Image/video moderasyonu** (decode sonrası NSFW heuristic/ONNX/API + pHash). En büyük tek boşluk.
- **P6 (M)** — Appeals + şeffaflık (kullanıcı neden quarantine'de olduğunu görsün).
- **P7 (L)** — Toxicity/harassment sınıflandırma (model-agnostic layer; `posts.rs:189` zaten buna hazır).
- **P8 (S)** — Trending anti-gaming (distinct-reactor ağırlık, shadow hariç, viewer-block filtre).

**İyi haber:** şema kemikleri hazır (`moderation_state`, `reports`, `moderation_log` `actor_kind IN ('ai','admin','system')`, `spam_score`, `federation_blocks`) — çoğu migration değil kod.

---

## 4) Correctness ("kusursuz")

### MEDIUM
- **B1** — Otomatik quarantine `spam_score` yazmıyor + `moderation_log` row'u yok (`posts.rs:425`) → admin kuyruğunda spam_score hep NULL, otomatik karar için audit izi yok. (= P0)
- **B2** — `replies_count` fire-and-forget `let _ = UPDATE` (`posts.rs:451,79,702`): o statement fail ederse sayaç kalıcı drift eder, reconciler yok. → reply insert/delete ile aynı transaction'a al, veya periyodik reconcile sweep. *(reactions_count self-heal'li — sorun değil.)*
- **B3** — `react` ilk-reaksiyon notify read-modify-write (`posts.rs:973`): çift-tap iki notify → double-notify. → upsert `RETURNING`/`xmax=0` ile karar ver.

### LOW
- **B4** — Trending viewer-block filtrelemiyor + reaction-count ranked (`trending.rs:109`).
- **B5/B6** — notifications/reports post'a bare-UUID (FK yok) → soft-delete 30g penceresinde admin rapor 404; `reply_to_id ON DELETE SET NULL` reply'ı root yapabilir (sweep guard'lı ama latent).
- **B7** — `edit_post` spam-gate/dedup re-run etmiyor (`posts.rs:723`) → temiz post'u edit'le spam'e çevir. Autonomy işi bunu kapatmalı.
- **B9** — Bazı read'ler hatayı boş-sonuca yutuyor (`trending.rs:91`, `users.rs:309`) → flapping DB "sessiz platform" gibi görünür. Metric/log ekle.

### Verified-good
Kullanıcı-girdisiyle erişilebilir panik **yok**; follower/following/post sayaçları live COUNT (drift edemez); follow/block TOCTOU kapalı (INSERT içinde re-check); SSRF guard kapsamlı; suspension her sorguda tutarlı; admin surface AdminUser-gated (API-token + pending-2FA reddediyor); çok-adımlı yazımlar tx/atomik-CTE.

---

## Önerilen uygulama sırası

**Faz 1 (hafta 1, düşük risk, yüksek getiri):** T1 PG tuning (kod yok) → W2 session throttle → W1 audit sample → C1 timeline/feed/trending cache (stampede-lock) → cgroup izolasyon (Meili/PG/Redis cap).
**Faz 2 (sorgu/şema):** Q2/Q1 index + batch viewer-state → Q3 trending precompute → W3 partition → M2 FK index → Q5/M1 counter denormalize.
**Faz 3 (moderasyon):** P0 (log+score) → P1 (rapor-eşiği) → P2 (heat/eskalasyon) → P5 (image safety) → P3/P4/P6.
**Faz 4 (güvenlik sertleştirme):** client_ip TRUSTED_PROXY + nginx teyidi → errors.rs statik mesaj → LOW'lar.
