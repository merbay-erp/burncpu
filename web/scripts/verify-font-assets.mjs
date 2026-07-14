import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, '..', 'dist');
const assets = join(dist, 'assets');
const index = readFileSync(join(dist, 'index.html'), 'utf8');

for (const packageName of [
  '@fontsource-variable/geist',
  '@fontsource-variable/geist-mono',
  '@fontsource-variable/material-symbols-outlined',
]) {
  const metadata = JSON.parse(readFileSync(join(root, '..', 'node_modules', packageName, 'package.json'), 'utf8'));
  if (metadata.license !== 'OFL-1.1') {
    throw new Error(`${packageName} must remain under the approved OFL-1.1 license`);
  }
}

if (/fonts\.(?:googleapis|gstatic)\.com/i.test(index)) {
  throw new Error('The production HTML still references Google Fonts');
}

const preloads = [...index.matchAll(/<link\s+rel="preload"\s+as="font"[^>]+>/g)]
  .map(([tag]) => tag);
if (preloads.length < 3) {
  throw new Error(`Expected at least three critical font preloads, found ${preloads.length}`);
}

for (const tag of preloads) {
  const href = tag.match(/href="([^"]+)"/)?.[1];
  if (!href?.startsWith('/assets/') || !/\.woff2$/.test(href)) {
    throw new Error(`Font preload is not a same-origin WOFF2 asset: ${tag}`);
  }
  const file = join(dist, href.slice(1));
  if (!statSync(file).isFile() || statSync(file).size < 100) {
    throw new Error(`Font preload asset is missing or empty: ${href}`);
  }
}

const css = readdirSync(assets)
  .filter((name) => name.endsWith('.css'))
  .map((name) => readFileSync(join(assets, name), 'utf8'))
  .join('\n');
if (!/font-display\s*:\s*swap/.test(css)) {
  throw new Error('Self-hosted fonts must use font-display: swap');
}
// Tailwind's inline SVG data URIs legitimately contain `http://www.w3.org`;
// only reject network URLs that are not data URIs.
if (/url\((?!\s*["']?data:)[^)]*https?:\/\//i.test(css)) {
  throw new Error('A production stylesheet contains an external font URL');
}

console.log(`font assets verified: ${preloads.length} preloads, ${[...css.matchAll(/\.woff2/g)].length} CSS references`);
