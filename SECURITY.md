# Güvenlik Politikası

Bir güvenlik açığı keşfettiyseniz, **lütfen GitHub Issue açmayın**.

## Bildirim

E-mail: **mustafa@mustafaerbay.com.tr**

Mümkünse mesajı PGP ile şifreleyin (anahtar [keys.openpgp.org](https://keys.openpgp.org/search?q=mustafa@mustafaerbay.com.tr) üzerinden).

## Beklenen yanıt süresi

| Aşama | Süre |
|-------|------|
| İlk yanıt | 48 saat |
| Triage + reproduce | 1 hafta |
| Fix + deploy | Severity'ye bağlı (kritik: 72 saat) |

## Kapsam

**Dahil:**
- `https://burncpu.com` üzerindeki herhangi bir RCE / SQLi / XSS / SSRF / auth bypass
- Magic-link veya session token leak / fixation / replay
- AI moderation bypass (spam yayınlama yolu)
- Rate limiting bypass

**Hariç:**
- Spam içerik raporu (oradan flag butonu kullan)
- DoS / DDoS (Cloudflare WAF zaten karşılıyor)
- 3rd party kütüphanedeki public CVE'ler (önce upstream'e bildir)
- Sosyal mühendislik / fiziksel saldırı

## Hall of Fame

Geçerli güvenlik bildiriminde bulunanlar burada listelenecek.
(Şu an boş — siz ilk olabilirsiniz 🐢)
