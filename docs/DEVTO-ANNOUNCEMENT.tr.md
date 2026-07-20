# Mastodon hesabımı kaybettikten sonra doğan sosyal ağ

[English draft](DEVTO-ANNOUNCEMENT.md) · Bu dosya Dev.to'ya yapıştırılabilir Türkçe
sürümdür; yayınlamadan önce taslak olarak inceleyin.

![burncpu — tek VPS yeter](https://burncpu.com/og-card.png)

> Yeni bir akış istemedim. Kendi çıkış kapımı istedim.

## Bu proje neden doğdu?

Bu proje sakin ama sarsıcı bir deneyimle başladı: Mastodon hesabım herhangi bir
uyarı olmadan kapatıldı.

Bunu tek bir platformun kararını tartışmak için yazmıyorum. Her servisin kendi
moderasyon sınırları ve her topluluğun uyması gereken kuralları var. Bende kalan
asıl duygu, kendi sosyal kimliğimin etrafındaki sistemi anlayamamak,
barındıramamak ve karara itiraz edememekti. Yazılarım, bağlantılarım ve bağlamım
bir anda benim kontrolümün dışındaki bir yerde kaldı.

Bu deneyim şu soruyu görmezden gelmeyi imkânsız hâle getirdi:

> Sosyal medya topluluklarımızın ve çalışmalarımızın yaşadığı yerse, neden daha
> fazla insan çalıştığı yeri kendisi çalıştıramasın?

**burncpu bu soruya verdiğim cevap.** Bir kişinin tek VPS üzerinde
çalıştırabileceği açık kaynaklı bir sosyal ağ temeli. Aynı yapı; üreticiler,
araştırmacılar, eğitimciler, yerel topluluklar veya kendi kurallarına ve
kimliğine ihtiyaç duyan her sektör için özel ağlara dönüştürülebilir.

Amaç yeni bir dikkat/bağımlılık makinesi kurmak değil; insanların kendi sosyal
alanını kurabilmesini mümkün kılmak.

## Özgürlük operasyonel olmalı

Özgürlük yalnızca README'de yazan bir slogan olmamalı. Şunları yapabilmek demek:

- isteğin sistemdeki yolunu ve güven sınırlarını incelemek;
- hesap verisini dışa aktarmak, silmek ve taşımak;
- moderasyon kararının nedenini anlamak ve itiraz etmek; ve
- servisi kontrol edilen altyapıda çalıştırmak.

Bu yüzden burncpu'nun çekirdeği self-hosted, kodu MIT lisanslı, moderasyon
kararları izlenebilir ve tek VPS kısıtı bir eksik değil tasarım özelliği.

## Tek temel, birçok topluluk

Aynı temel herkesi tek bir küresel akışa zorlamadan farklı topluluklara hizmet
edebilir:

- bağımsız üreticiler ve küçük ürün ekipleri;
- düşük gürültülü bir tartışma alanı isteyen araştırmacılar;
- öğretmenler, öğrenciler ve yerel öğrenme toplulukları;
- kendi moderasyon kurallarına sahip meslek birlikleri; veya
- sosyal katmanını kendisi yönetmek isteyen mahalle, etkinlik ve kuruluşlar.

Önemli olan logo ya da varsayılan renk paleti değil; kuralları çatallayabilmek,
servisi çalıştırabilmek ve “sağlıklı sohbet”in ne olduğuna kullanıcılarla birlikte
karar verebilmek.

## Neden tek VPS?

“Tek VPS yeter” her sistemin sonsuza kadar küçük kalması gerektiği iddiası değil,
ilk kurulumu anlaşılır tutan bir mühendislik kısıtı:

```text
Cloudflare → nginx → Rust/Axum
                         ├── PostgreSQL 16
                         ├── Redis 7
                         └── Meilisearch
```

API tek Rust binary'sidir. Üretim container'ı `3050` portunu dinler ve yalnızca
VPS loopback'ine yayınlanır; dışarıya açık tek giriş nginx'tir. Migration'lar
açılışta ileri yönde uygulanır. Kubernetes, service mesh veya işletilecek bir
message broker yoktur.

## Kullanıcılar neler yapabilir?

- Tek kullanımlık magic-link, passkey veya isteğe bağlı OAuth ile giriş yapabilir.
- Temizlenmiş Markdown post, yanıt ve repost yazabilir.
- Kişi/hashtag takip edebilir, arama yapabilir, trendleri görebilir.
- Karşılıklı takipte DM, görsel/video eki, reaksiyon, okundu ve yazıyor durumu
  kullanabilir.
- Web Push veya native APNs/FCM bildirimi alabilir.
- ActivityPub açıkken federe hesapları ve postları keşfedebilir.
- Hesabını dışa aktarabilir/silebilir, oturumları iptal edebilir, 2FA ve passkey
  yönetebilir.

Moderasyon sonradan eklenen bir özellik değil, tasarımın parçasıdır. Hesap
güveni, link/domain itibarı, denylist, toksisite ipuçları, hesap ısısı ve rapor
eşikleri; quarantine, shadow-ban veya askıya alma üretebilir. Kararlar geri
alınabilir, denetlenebilir ve itiraz edilebilir.

## Açıklayabildiğim güvenlik

Uygulama varsayılan olarak şifresizdir. Oturum çerezleri `HttpOnly`, `Secure` ve
`SameSite=Lax`; magic-link token'ları kısa ömürlü, tek kullanımlık ve yalnızca
hash olarak saklanır. Admin rotaları admin rolü ve 2FA-satisfied session ister.

Kullanıcı Markdown'ı sunucuda temizlenir. Link preview istemcisi IP-pinned,
redirect-checked ve byte-capped'dir; upload'lar sniff/re-encode/size limitleriyle
korunur. SQL parametreli sorgular kullanır; her istekte `x-request-id` vardır.
Web bundle Google Fonts çağırmaz, WOFF2 fontlar same-origin sunulur ve CSP
`font-src 'self' data:` ile sınırlıdır.

## Sıkıcı kısımlar testli

47 Rust testi, Clippy/format, web Vitest ve Playwright, Expo web E2E, Maestro/EAS
native akışları, dependency/license/gitleaks kontrolleri ve izole yük kapıları
CI'da çalışır. PR profili 1.000 SSE + 2.000 HTTP; soak profili 10.000 SSE +
10.000 HTTP istektir. Üretime yük testi gönderilmez.

## Yerelde çalıştır

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

Kod MIT lisanslıdır. `burncpu` adı, logosu ve maskotu ayrı marka haklarına
tabidir. Bu fikri büyütürseniz neleri basit tuttuğunuzu ve neleri bilinçli olarak
dışarıda bıraktığınızı duymak isterim.
