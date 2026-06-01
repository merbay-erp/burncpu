/// Turkish-aware relative time. Returns strings like "şimdi", "5dk",
/// "2sa", "3g", or an absolute date for older posts.
export function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = (Date.now() - t) / 1000; // seconds
  if (diff < 30) return 'şimdi';
  if (diff < 60) return `${Math.floor(diff)}sn`;
  if (diff < 3600) return `${Math.floor(diff / 60)}dk`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}sa`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}g`;
  const d = new Date(t);
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

/// First http(s) URL in a chunk of text, with trailing prose punctuation
/// trimmed (but balanced parens kept, e.g. Wikipedia links). Returns null when
/// there's nothing link-preview-worthy. Used to drive the unfurl card.
export function firstUrl(text: string): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s<]+/i);
  if (!m) return null;
  let u = m[0];
  for (;;) {
    const last = u[u.length - 1];
    if (last === ')') {
      const opens = (u.match(/\(/g) || []).length;
      const closes = (u.match(/\)/g) || []).length;
      if (closes > opens) {
        u = u.slice(0, -1);
        continue;
      }
      break;
    }
    if (last && '.,;:!?\'"»>]}'.includes(last)) {
      u = u.slice(0, -1);
      continue;
    }
    break;
  }
  // Needs a dotted host to be worth unfurling (filters "http://localhost"-ish).
  return u.length > 10 && /^https?:\/\/[^/]+\.[^/]/i.test(u) ? u : null;
}

/// Visible character count (Intl.Segmenter — counts grapheme clusters,
/// not UTF-16 code units, so emoji and combining marks don't lie).
let _seg: Intl.Segmenter | null = null;
export function visibleLength(s: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    if (!_seg) _seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let n = 0;
    for (const _ of _seg.segment(s)) n++;
    return n;
  }
  return Array.from(s).length;
}
