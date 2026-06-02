<!-- Teşekkürler! Lütfen CONTRIBUTING.md'i okuduğundan emin ol. -->

## Ne / Niçin

<!-- Bu PR neyi değiştiriyor ve neden? Bağlam ver. -->

## Değişiklik türü

- [ ] 🐛 Bug fix
- [ ] ✨ Yeni özellik
- [ ] ♻️ Refactor / temizlik
- [ ] 📝 Doküman
- [ ] 🎨 UI / stil
- [ ] 🔒 Güvenlik

## Nasıl doğrulandı

<!-- Adımlar, komutlar, ekran görüntüleri. -->

## Kontrol listesi

- [ ] `cargo clippy --all-targets -- -D warnings` temiz (backend değiştiyse)
- [ ] `cd web && npx tsc -b && npm run build` temiz (frontend değiştiyse)
- [ ] UI değişikliği → **açık ve koyu** temada + **mobilde** (≈390px) kontrol edildi
- [ ] Yeni kullanıcı metni → `i18n.ts`'e `tr` + `en` eklendi
- [ ] DB değişikliği → sıralı bir `migrations/00NN_*.sql` eklendi
- [ ] İlgili dokümanlar (README / ARCHITECTURE / docs/API) güncellendi

## İlgili issue'lar

<!-- Closes #123 -->
