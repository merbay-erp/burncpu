import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Fontsource emits the licensed WOFF2 files as hashed assets. Keep the
// highest-value text faces (body and metadata, including Turkish Latin-ext)
// discoverable in the initial HTML without hard-coding a hash that changes on
// every build. Material Symbols is intentionally not preloaded: its full
// variable glyph table is ~1.1 MB and should load on demand when an icon is
// first rendered.
function fontPreloadPlugin(): Plugin {
  const criticalFont = /(?:^|\/)(?:geist-(?:latin|latin-ext)-wght-normal|geist-mono-(?:latin|latin-ext)-wght-normal)-[^/]+\.woff2$/;

  return {
    name: 'burncpu-font-preload',
    apply: 'build',
    writeBundle(options, bundle) {
      const fonts = Object.keys(bundle).filter((name) => criticalFont.test(name));
      if (fonts.length === 0) throw new Error('Font preload assets were not emitted');

      const links = fonts
        .sort()
        .map((name) => `    <link rel="preload" as="font" type="font/woff2" href="/${name}" crossorigin />`)
        .join('\n');
      const outDir = options.dir ?? dirname(options.file ?? 'dist/index.html');
      const indexPath = join(outDir, 'index.html');
      const index = readFileSync(indexPath, 'utf8');
      if (!index.includes('rel="preload" as="font"')) {
        writeFileSync(indexPath, index.replace('</head>', `${links}\n  </head>`));
      }
    },
  };
}

export default defineConfig({
  plugins: [solid(), fontPreloadPlugin()],
  build: {
    target: 'es2022',
    // Do not publish source maps with the public production assets. Add a
    // private error-reporting upload step before re-enabling them.
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'https://burncpu.com',
      '/rss': 'https://burncpu.com',
    },
  },
});
