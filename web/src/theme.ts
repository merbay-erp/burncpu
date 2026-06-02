// Theme toggle — dark (default) vs a soft sage light. The actual colors live
// in styles.css (`:root` dark, `html.light` overrides); here we just flip the
// class on <html> and persist the choice. An inline script in index.html sets
// the class before first paint to avoid a flash; this keeps it in sync.

import { createSignal } from 'solid-js';

type Theme = 'dark' | 'light';
const KEY = 'burncpu.theme';

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch { /* ignore */ }
  return 'dark';
}

function apply(t: Theme) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.classList.toggle('light', t === 'light');
  el.classList.toggle('dark', t === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#f4ece4' : '#171311');
}

export const [theme, _setTheme] = createSignal<Theme>(read());
apply(theme());

export function setTheme(t: Theme) {
  _setTheme(t);
  apply(t);
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
}

export function toggleTheme() {
  setTheme(theme() === 'dark' ? 'light' : 'dark');
}
