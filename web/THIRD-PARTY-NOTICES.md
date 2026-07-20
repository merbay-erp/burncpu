# Web font notices

🇹🇷 [Türkçe sürüm](THIRD-PARTY-NOTICES.tr.md)

The web bundle includes these self-hosted fonts through the pinned Fontsource
packages in `package-lock.json`:

- Geist — Copyright 2024 The Geist Project Authors — SIL Open Font License 1.1
- Geist Mono — Copyright 2024 The Geist Project Authors — SIL Open Font License 1.1
- Material Symbols Outlined — Copyright Google Inc. — SIL Open Font License 1.1

The corresponding license text is shipped by each package at
`node_modules/@fontsource-variable/*/LICENSE` and is checked during the
production build by `npm run verify:font-assets`. Font files are served only
from the burncpu origin; they are not fetched from Google at runtime.

SIL Open Font License 1.1: <https://scripts.sil.org/OFL>
