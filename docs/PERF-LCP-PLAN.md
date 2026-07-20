# burncpu — Mobil LCP / SSR İyileştirme Planı

> Tarihsel ölçüm: 2026-06-06. Durum yenilemesi: 2026-07-20.
> Bu doküman **kod değiştirmez** — SSR hâlâ ayrı bir karar/PR konusudur.
> Font self-hosting, preload ve `font-display: swap` çalışması tamamlandı; aşağıdaki
> LCP ölçümleri yeni bir Lighthouse koşusu yapılana kadar tarihsel lab verisidir.

## 1) Ölçülmüş durum (neyi çözüyoruz)

Lighthouse mobil (slow-4G + 4× CPU throttle), anonim `/` rotası:

| Metrik | Değer | Not |
|---|---|---|
| LCP | ~9.7s | 🔴 tek kalan zayıf metrik |
| FCP | 1.3–2.0s | 🟢 |
| TBT | 0–14ms | 🟢 (font/round-trip işiyle 80→0) |
| CLS | <0.1 | 🟢 |
| perf | 72–75 | — |

**LCP fazları:** `Load Delay %57 (5.7s)` + `Load Time %35 (3.46s)` + TTFB/Render %8.

- **Load Delay 5.7s** = JS boot + `/posts` fetch + SolidJS render. İçerik (LCP
  görseli dahil) ancak bu zincir bitince **var oluyor** → hiçbir görsel-öncelik
  ipucu erkene çekemez. Bu, client-rendered SPA'nın mimari sınırı.
- **Load Time 3.46s** = LCP kapağının dış origin'den (blog) inmesi.

> ⚠️ **Bu LAB en-kötü-durum.** Aynı kapak gerçek bağlantıda **0.18s**'de geliyor
> (ölçüldü). SSR yatırımı esasen **PSI lab skorunu** ve **en yavaş ~%25 kullanıcıyı**
> iyileştirir; medyan gerçek kullanıcı zaten hızlı.

## 2) Neden SSR (ve sadece SSR Load Delay'i çözer)

Client-render'da içerik, JS yüklenip veri dönene kadar boyanamaz → Load Delay
kaçınılmaz. SSR'da sunucu **ilk görünümü HTML olarak** üretir → LCP içeriği ilk
yanıtla gelir → ~FCP'de boyanır → **Load Delay ~0**, LCP ~3.5–4s'e iner.

Daha önce uygulanan güvenli kaldıraçlar (font non-blocking, inline link-preview,
preconnect, lean ilk-sayfa) Load Delay'in **kenarlarını** yontar ama duvarı yıkmaz.

## 3) burncpu'ya özgü zorluk

**Rust/Axum backend + SolidJS SPA.** SolidStart Node-tabanlı; ortak runtime yok.
Üç gerçekçi yol:

### Seçenek A — Tam SolidStart (Node SSR) migrasyonu
- Web tümüyle SolidStart'a taşınır; Rust API'nin önünde/yanında bir Node SSR servisi.
- ➕ Tam SSR + hydration, en iyi LCP, gelecekte SEO/paylaşım da kazanır.
- ➖ **En büyük iş:** routing + data-fetching + hydration yeniden; ayrı Node servisi +
  deploy/altyapı karmaşası; CSP/oturum entegrasyonu. Haftalar, yüksek risk.

### Seçenek B — Rust'ta hafif "ilk-paint SSR" *(ÖNERİLEN)*
- Rust backend, anonim `/` isteğinde `index.html`'e **ilk ~3 postun HTML'ini**
  (zaten DB'de `body_html` var) + ilk kapak `<img>`'ini **enjekte eder**
  (server-rendered first paint). SPA mount olunca devralır.
- LCP görseli **ilk HTML'de** → ~FCP'de boyanır → Load Delay çöker.
- ➕ Framework migrasyonu yok; mevcut Rust + Solid korunur; cerrahi + feature-flag'li.
- ➖ Server-HTML ↔ client-render uyumu (yoksa kısa flicker/hydration mismatch);
  inline içerik için CSP hash; sadece anonim public timeline (auth-spesifik değil).
- Risk: **orta**, aşamalı yapılabilir.

### Seçenek C — Statik iskelet + ilk-post placeholder (kısmi)
- `index.html`'e anlamlı above-the-fold iskelet. Algılanan hızı artırır ama LCP
  görseli hâlâ JS sonrası → LCP'yi tam çözmez. Düşük risk, küçük kazanç.

## 4) Öneri + aşamalı plan (Seçenek B)

1. **Scope:** yalnız anonim `/` (Lighthouse'un ölçtüğü). `GET /` Rust handler'ı
   `/posts?limit=3` sonucunu sunucuda HTML'e gömer.
2. **Render:** mevcut `body_html` + `link_preview` (zaten cache'te) → ilk kart +
   eager kapak `<img>`. Ek DB yükü yok (cache).
3. **Hydration:** SPA boot olunca server-HTML'i sökmeden/eşleyerek devral; mismatch
   testleri.
4. **Güvenlik:** feature-flag (`SSR_HOME=1`), CSP hash, kademeli açılış + ölç.
5. **Genişletme:** çalışırsa `/u/:user` ve `/posts/:id` (paylaşım/SEO kazanır).

**Beklenen:** LCP ~9.7s → ~3.5–4s (lab); FCP/CLS/TBT korunur.

## 5) Karar çerçevesi

- **Hedef = PSI lab skoru / en yavaş kullanıcılar** → Seçenek B değer (orta efor/risk).
- **Hedef = medyan gerçek kullanıcı** → mevcut hâl zaten iyi (kapak 0.18s); SSR ertelenebilir.
- **Yapılmayacak (şimdilik):** Seçenek A (tam SolidStart) — lab-cosmetic getiri için
  risk/efor orantısız.

## 6) Bağlam: blog kapak görselleri (ayrı konu)

LCP kapağı blog'dan (`mustafaerbay.com.tr`, ayrı prod) geliyor. Edge optimizasyonu
(CF Polish) **Pro plan** gerektiriyor (zone Free) → maliyet kararı. Repo-içi WebP
migrasyonu mümkün ama **1238 kapak / 1180 post** + kodda bilinçli "og:image = PNG"
(RSS uyumu) kararı var → büyük, dikkatli ele alınması gereken ayrı iş. Getiri
yine lab-cosmetic (gerçek kapak 0.18s).
