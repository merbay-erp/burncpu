# Mastodon hesabımı kaybettim. Sonra kendi sosyal ağımı kurdum.

[🇬🇧 English version](https://github.com/merbay-erp/burncpu/blob/main/docs/DEVTO-ANNOUNCEMENT.md) · [Canlı demo](https://burncpu.com) · [Kaynak kodu](https://github.com/merbay-erp/burncpu)

![burncpu — ızgaradan çıkış](https://burncpu.com/devto-cover-v2.png)

> Yeni bir akış istemedim. Kendi çıkış kapımı istedim.

*burncpu, sosyal kimliğimin kontrolünü kaybetme deneyiminden doğdu; bugün ise
toplulukların buluştuğu yeri kendisinin yönetebilmesi için açık kaynaklı bir
temel sunuyor.*

| | |
| --- | --- |
| **Fikir** | Sosyal paylaşım, bütün sistemi teslim etmeden mümkün olmalı. |
| **Biçim** | Tek kişinin tek VPS üzerinde çalıştırabileceği tam bir sosyal platform. |
| **Davet** | Yapıyı kendi topluluğun, sektörün ve kuralların için çatallandır. |

## 01 — Bu proje neden doğdu?

Bu proje sakin ama sarsıcı bir deneyimle başladı: Mastodon hesabım herhangi bir
uyarı olmadan kapatıldı.

Bunu tek bir platformun kararını tartışmak için yazmıyorum. Her servisin kendi
moderasyon sınırları ve her topluluğun uyması gereken kuralları var. Bende kalan
asıl duygu; kendi sosyal kimliğimin etrafındaki sistemi anlayamamak,
barındıramamak ve karara itiraz edememekti. Yazılarım, bağlantılarım ve bağlamım
bir anda benim kontrolümün dışındaki bir yerde kaldı.

Bu deneyim şu soruyu görmezden gelmeyi imkânsız hâle getirdi:

> Topluluklarımız ve çalışmalarımız sosyal medyada yaşıyorsa, neden daha fazla insan yaşadığı yeri kendisi çalıştıramasın?

**burncpu bu soruya verdiğim cevap.** Bir kişinin tek VPS üzerinde
çalıştırabileceği self-hosted, açık kaynaklı bir sosyal ağ. Aynı temel;
üreticiler, araştırmacılar, eğitimciler, meslek grupları, mahalleler veya kendi
kimliğine ve moderasyon modeline ihtiyaç duyan her topluluk için odaklı bir ağa
dönüşebilir.

Amaç yeni bir dikkat makinesi kurmak değil; paylaşımı ve topluluk sahipliğini
yeniden mümkün hissettirmek.

## 02 — Özgürlük operasyonel olmalı

Özgürlük yalnızca README'de yazan bir slogan olmamalı. Günlük hayatta şunları
yapabilmek demek:

- isteğin sistemdeki yolunu ve güven sınırlarını incelemek;
- hesap verisini dışa aktarmak, silmek ve taşımak;
- moderasyon kararının nedenini anlamak ve itiraz etmek; ve
- servisi kontrol edilen altyapıda çalıştırmak.

Bu yüzden burncpu'nun çekirdeği self-hosted, uygulama kodu MIT lisanslı,
moderasyon kararları izlenebilir ve tek VPS kısıtı bir eksik değil tasarım
özelliği.

> **Sözümüz:** Sistem anlaşılabilecek kadar küçük, güvenilebilecek kadar sağlam ve sahiplenilebilecek kadar açık olmalı.

## 03 — Tek temel, birçok topluluk

Aynı temel herkesi tek bir küresel akışa zorlamadan farklı topluluklara hizmet
edebilir:

- bağımsız üreticiler ve küçük ürün ekipleri;
- düşük gürültülü bir tartışma alanı isteyen araştırmacılar;
- öğretmenler, öğrenciler ve yerel öğrenme toplulukları;
- kendi moderasyon kurallarına sahip meslek birlikleri; veya
- sosyal katmanını kendisi yönetmek isteyen mahalle, etkinlik ve kuruluşlar.

Önemli olan logo ya da varsayılan renk paleti değil; kuralları
çatallandırabilmek, servisi çalıştırabilmek ve “sağlıklı sohbet”in ne olduğuna
kullanıcılarla birlikte karar verebilmek.

## 04 — Tek VPS tasarım bahsi

“Tek VPS yeter” her sistemin sonsuza kadar küçük kalması gerektiği iddiası değil;
ilk kurulumu anlaşılır tutan bir mühendislik kısıtı:

```text
Cloudflare
    │ TLS, WAF ve edge koruması
nginx
    │ güvenlik başlıkları + reverse proxy
Rust/Axum
    ├── PostgreSQL 16  (kaynağın aslı)
    ├── Redis 7        (rate limit, oturum, geçici durum)
    └── Meilisearch    (genel arama)
```

API tek Rust binary'sidir. Üretim container'ı `3050` portunu dinler ve yalnızca
VPS loopback'ine yayınlanır; dışarıya açık tek giriş nginx'tir. Migration'lar
açılışta ileri yönde uygulanır. Kubernetes cluster'ı, service mesh veya
işletilecek bir message broker yoktur.

Cloudflare, SMTP ve isteğe bağlı OAuth sağlayıcıları açık entegrasyon
sınırlarıdır; veri yolunda gizli bağımlılıklar değildir. Merkez VPS'in üzerinde
kalır.

## 05 — Kullanıcılar neler yapabilir?

- Tek kullanımlık magic-link, passkey veya isteğe bağlı OAuth ile giriş yapabilir.
- Temizlenmiş Markdown post, yanıt ve repost yazabilir.
- Kişi ve hashtag takip edebilir, arama yapabilir, trendleri görebilir.
- Karşılıklı takipte DM, görsel/video eki, reaksiyon, okundu ve yazıyor durumu
  kullanabilir.
- EXIF temizleme, boyut sınırı ve kontrollü transcode ile medya yükleyebilir.
- Web Push veya native APNs/FCM bildirimi alabilir.
- ActivityPub açıkken federe hesapları ve postları keşfedebilir.
- Hesabını dışa aktarabilir/silebilir, oturumları iptal edebilir, 2FA ve passkey
  yönetebilir.

Moderasyon sonradan eklenen bir özellik değil, tasarımın parçasıdır. Hesap
güveni, link/domain itibarı, denylist, toksisite ipuçları, hesap ısısı ve rapor
eşikleri; içeriği veya hesabı quarantine, shadow-ban ya da askıya alma yoluna
götürebilir. Kararlar geri alınabilir, denetlenebilir ve itiraz edilebilir.

## 06 — Güven bir özellik

Uygulama varsayılan olarak şifresizdir. Oturum çerezleri `HttpOnly`, `Secure` ve
`SameSite=Lax`; magic-link token'ları kısa ömürlü, tek kullanımlık ve yalnızca
hash olarak saklanır. Admin rotaları admin rolü ve 2FA doğrulanmış bir oturum
ister. Passkey ilk faktördür; TOTP'yi atlayan bir yol değildir.

Kullanıcı Markdown'ı sunucuda render edilir ve temizlenir. Link preview istemcisi
IP-pinned, redirect-checked ve byte-capped'dir; böylece sunucu açık proxy'ye
dönüşmez. Upload'lar sniff, re-encode ve boyut sınırlarıyla korunur. SQL
parametreli sorgular kullanır; her istekte `x-request-id` vardır ve hassas yollar
audit log'da maskelenir.

Web bundle Google Fonts çağırmaz. Geist, Geist Mono ve Material Symbols,
OFL-1.1 lisanslı Fontsource paketleri olarak sabitlenir; same-origin WOFF2
asset'leri üretilir, gerekli yerlerde preload edilir ve build sırasında kontrol
edilir. Production CSP yalnızca `font-src 'self' data:` izler.

## 07 — Sıkıcı kısımlar kanıtlı

Proje yalnızca derleniyor mu diye ölçülmüyor:

- 47 Rust testi, format ve warnings denied Clippy;
- masaüstü ve mobil viewport'larda web Vitest regresyon testleri ve 28 Playwright
  akışı;
- Android ve iOS boyutları için Expo web Playwright akışları;
- EAS workflow'larıyla yönetilen cihazlarda native Android ve iOS Maestro
  akışları;
- GitHub Actions içinde dependency, lisans/kaynak politikası, gitleaks ve
  production build kontrolleri; ve
- kimlik doğrulanmış bildirim SSE bağlantılarını açık tutarken health, timeline,
  search ve sitemap yollarını deneyen korumalı runner.

Pull-request profili **1.000 SSE + 2.000 HTTP isteği**dir. İzole soak profili
60 saniye boyunca **10.000 SSE + 10.000 HTTP** çalıştırır. Runner, tasarım
gereği `burncpu.com` ve diğer production alan adlarını reddeder; production'a
yük testi gönderilmez.

## 08 — Trade-off'lar görünür kalsın

burncpu kendisini hyperscale bir platform gibi göstermiyor. Bir VPS, bir admin
rolü ve media CDN olmadan çalışıyor. Öğrenen ML moderasyonu şart değil; mevcut
katman açıklanabilir sezgiler ve insan itirazları üzerine kurulu. Native cihaz
E2E'si EAS cihaz ortamına, browser E2E'si ise yerel çalışmaya ve GitHub Actions'a
bağlı.

Bu sınırlar hata modlarını incelemeyi, aylık maliyeti okumayı ve bir kişinin
değişiklik yapmadan önce bütün istek yolunu görebilmesini kolaylaştırıyor.

## 09 — Çalıştır, çatallandır, sahiplen

```bash
git clone https://github.com/merbay-erp/burncpu.git
cd burncpu
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d --wait
cargo run --release
```

İkinci terminalde:

```bash
cd web
npm ci
npm run dev
```

Kurulum ve ortam referansının tamamı [README](https://github.com/merbay-erp/burncpu/blob/main/README.md),
[yapılandırma rehberi](https://github.com/merbay-erp/burncpu/blob/main/docs/CONFIGURATION.md),
[API referansı](https://github.com/merbay-erp/burncpu/blob/main/docs/API.md) ve
[deployment runbook](https://github.com/merbay-erp/burncpu/blob/main/docs/DEPLOYMENT.md)
içinde.

Uygulama kodu MIT lisanslıdır. `burncpu` adı, logosu ve maskotu ayrı marka
haklarına tabidir; kod lisansından marka lisansı sonucu çıkarılmamalıdır.

Bu “küçük, anlaşılır ve yüksek sinyalli” hedefle bir şey kurarsanız neleri basit
tuttuğunuzu ve neleri bilinçli olarak dışarıda bıraktığınızı duymak isterim.

Asıl davet şu: bir platforma daha katılmak değil, zaten var olmasını istediğiniz
sosyal alanı birlikte kurmak.
