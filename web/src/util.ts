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

/// Remove a URL from rendered post HTML once it's shown as a preview card, so
/// the raw link doesn't appear twice. DOM-based (robust to anchors vs plain
/// text); tidies up the now-trailing <br> / empty paragraph it leaves behind.
export function stripUrl(html: string, url: string): string {
  if (!html || !url || typeof document === 'undefined') return html;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  let removed = false;
  // 1) An anchor that *is* this URL.
  for (const a of Array.from(tmp.querySelectorAll('a'))) {
    if (a.getAttribute('href') === url || (a.textContent || '').trim() === url) {
      const prev = a.previousSibling;
      a.remove();
      if (prev && prev.nodeName === 'BR') prev.remove();
      removed = true;
      break;
    }
  }
  // 2) A plain-text occurrence.
  if (!removed) {
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.nodeValue || '';
      const idx = text.indexOf(url);
      if (idx !== -1) {
        node.nodeValue = text.slice(0, idx) + text.slice(idx + url.length);
        if (!(node.nodeValue || '').trim()) {
          const prev = (node as ChildNode).previousSibling;
          if (prev && prev.nodeName === 'BR') prev.remove();
        }
        break;
      }
      node = walker.nextNode();
    }
  }
  // 3) Tidy: drop trailing <br>/whitespace and any now-empty paragraph.
  for (const p of Array.from(tmp.querySelectorAll('p'))) {
    while (
      p.lastChild &&
      (p.lastChild.nodeName === 'BR' ||
        (p.lastChild.nodeType === 3 && !(p.lastChild.nodeValue || '').trim()))
    ) {
      p.lastChild.remove();
    }
    if (!(p.textContent || '').trim() && !p.querySelector('img, a')) p.remove();
  }
  return tmp.innerHTML;
}

/// Lightweight linkifier for snippet / search-result views that only have the
/// raw post body (Meilisearch hits carry `body`, not the server-rendered
/// `body_html`). HTML-escapes first, then turns @mentions and #hashtags into
/// links — mirroring the server's linkify rules closely enough for previews.
/// Bare URLs are intentionally left plain (the site never autolinks them in
/// body_html either; the unfurl card carries the link). Output is safe HTML:
/// escaping happens before any tag insertion and link targets are constrained
/// to [A-Za-z0-9_], so nothing user-controlled reaches an attribute unescaped.
export function linkifyTags(raw: string): string {
  if (!raw) return '';
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped
    // @mentions → /u/<name> (all-lowercase 3–32, same boundary as the server)
    .replace(/(^|[\s.,!?([])@([a-z0-9_]{3,32})/g, (_m, pre, name) =>
      `${pre}<a href="/u/${name}">@${name}</a>`)
    // #hashtags → /hashtag/<lower>, visible text keeps the author's casing
    .replace(/(^|[\s.,!?([])#([A-Za-z0-9_]{3,32})/g, (_m, pre, name) =>
      `${pre}<a href="/hashtag/${name.toLowerCase()}">#${name}</a>`);
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
