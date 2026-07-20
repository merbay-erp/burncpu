# burncpu — Mastodon hesabımı kaybettikten sonra doğan tek-VPS sosyal ağ

[English draft](DEVTO-ANNOUNCEMENT.md) · Bu dosya doğrudan Dev.to'ya yapıştırılabilir
Türkçe sürümdür; front matter'da `published: false` bırakılmıştır.

![burncpu — tek VPS yeter](https://burncpu.com/og-card.png)

## Bu proje neden doğdu?

Bu proje sakin ama sarsıcı bir deneyimle başladı: Mastodon hesabım herhangi bir
uyarı olmadan kapatıldı.

Bunu tek bir platformun kararını tartışmak için yazmıyorum. Her servisin kendi
moderasyon sınırları ve her topluluğun uyması gereken kuralları var. Bende kalan
asıl duygu, kendi sosyal kimliğimin etrafındaki sistemi anlayamamak, barındıramamak
ve karara itiraz edememekti. Yazılarım, bağlantılarım ve bağlamım bir anda benim
kontrolümün dışındaki bir yerde kaldı.

Bu deneyim şu soruyu görmezden gelmeyi imkânsız hâle getirdi: Sosyal medya
topluluklarımızın ve çalışmalarımızın yaşadığı yerse, neden daha fazla insan
çalıştığı yeri kendisi çalıştıramasın?

**burncpu bu soruya verdiğim cevap.** Bir kişinin tek VPS üzerinde çalıştırabileceği
açık kaynaklı bir sosyal ağ temeli. Aynı yapı; üreticiler, araştırmacılar,
eğitimciler, yerel topluluklar veya kendi kurallarına ve kimliğine ihtiyaç duyan
her sektör için özel ağlara dönüştürülebilir.

Amaç yeni bir dikkat/bağımlılık makinesi kurmak değil; insanların kendi sosyal
alanını kurabilmesini mümkün kılmak.

## Özgürlük operasyonel olmalı

Özgürlük yalnızca README'de yazan bir slogan olmamalı. İsteğin sistemdeki yolunu
inceleyebilmek, hesabı dışa aktarabilmek ve silebilmek, moderasyon kararının
nedenini anlayabilmek, itiraz edebilmek ve servisi kontrol edilen altyapıya
taşıyabilmek demek. Bu yüzden çekirdek self-hosted, kod MIT lisanslı, moderasyon
izlenebilir ve tek VPS kısıtı bir eksik değil tasarım özelliği.

## Tek VPS ile yüksek sinyalli sosyal alan

burncpu, Rust/Axum API, SolidJS web ve Expo mobil istemcisini tek VPS üzerinde
çalıştıran MIT lisanslı açık kaynak bir sosyal platformdur. Amaç trafik rekoru
değil; gerçek insanların düşünerek yazdığı, okunabilir ve denetlenebilir bir
alan kurmaktır.

## Öne çıkanlar

Şifresiz magic-link, WebAuthn passkey ve isteğe bağlı OAuth/PKCE; thread/repost/
bookmark/trash; Meilisearch arama; SSE bildirimleri; medya ve reaksiyonlu DM;
ActivityPub/RSS; native push ve universal link desteği bulunur. Spam, toksisite,
domain itibarı, rapor eşiği ve hesap ısısı katmanları quarantine → shadow-ban →
askıya alma akışını üretir; kararlar audit edilir ve itiraz edilebilir.

## Operasyon ve güvenlik

Cloudflare → nginx → loopback `:3060` → Axum container `:3050` zinciri vardır.
Postgres/Redis/Meilisearch private Docker ağındadır. CI format/test/clippy,
güvenlik/lisans/secret taraması, web/mobile audit-build-lint, browser E2E,
Maestro/EAS akışları ve 1k/2k ile 10k/10k yük gate'lerini çalıştırır. Web fontları
same-origin WOFF2 olarak self-host edilir; Google Fonts yokluğu build'de doğrulanır.

## Sınırlar

Yük testi üretime uygulanmaz. Media CDN, öğrenilmiş ML moderasyonu ve multi-admin
RBAC kapsam dışıdır. Cloudflare, SMTP ve etkin OAuth sağlayıcıları açıkça dış
entegrasyon sınırlarıdır.
