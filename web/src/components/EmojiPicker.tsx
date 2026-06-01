// Tiny built-in emoji picker. Curated ~120 common emoji across categories;
// no external library. Searchable by keyword (English + Turkish). Click
// to insert. Toggle from any composer with a single button.

import { createSignal, For, Show, onCleanup, onMount } from 'solid-js';
import { t } from '../i18n';

interface Emoji {
  c: string;        // character
  kw: string;       // space-separated keywords (TR + EN)
}

const EMOJI: Record<string, Emoji[]> = {
  'Sık': [
    { c: '🔥', kw: 'ateş fire lit' },
    { c: '🐢', kw: 'kaplumbağa turtle burncpu yavaş slow' },
    { c: '🤝', kw: 'handshake selamla anlaştık' },
    { c: '🙏', kw: 'pray dua teşekkür thanks' },
    { c: '😂', kw: 'gülme joy laugh ha' },
    { c: '❤️', kw: 'kalp heart love sevgi' },
    { c: '👍', kw: 'thumbs up beğeni iyi' },
    { c: '👏', kw: 'alkış clap bravo' },
    { c: '💯', kw: '100 yüz tam perfect' },
    { c: '✨', kw: 'parıltı yıldız sparkle special' },
  ],
  'Yüzler': [
    { c: '😀', kw: 'gülümseme smile happy' },
    { c: '😅', kw: 'utangaç sheepish' },
    { c: '🤔', kw: 'düşünme think hmm' },
    { c: '😎', kw: 'havalı cool gözlük' },
    { c: '🥲', kw: 'üzgün gülen' },
    { c: '😭', kw: 'ağlama cry sob' },
    { c: '🤯', kw: 'patlama mind blown' },
    { c: '😴', kw: 'uyku sleep zzz' },
    { c: '🤐', kw: 'sus quiet zip' },
    { c: '😡', kw: 'kızgın angry mad' },
    { c: '🥶', kw: 'soğuk cold' },
    { c: '🥵', kw: 'sıcak hot' },
    { c: '🤤', kw: 'salya drool' },
    { c: '🤠', kw: 'kovboy cowboy' },
    { c: '🤖', kw: 'robot bot AI ai' },
    { c: '👻', kw: 'hayalet ghost' },
  ],
  'El & Vücut': [
    { c: '👌', kw: 'ok ok mükemmel' },
    { c: '✌️', kw: 'peace zafer' },
    { c: '🤘', kw: 'rock metal' },
    { c: '🫡', kw: 'salute selam' },
    { c: '🤌', kw: 'che vuoi italya' },
    { c: '🫂', kw: 'sarılma hug' },
    { c: '💪', kw: 'pazı muscle güçlü' },
    { c: '🧠', kw: 'beyin brain' },
    { c: '👀', kw: 'gözler eyes bakış' },
    { c: '👋', kw: 'merhaba wave hi' },
  ],
  'Doğa & Hayvan': [
    { c: '🐱', kw: 'kedi cat' },
    { c: '🐶', kw: 'köpek dog' },
    { c: '🦊', kw: 'tilki fox' },
    { c: '🐺', kw: 'kurt wolf' },
    { c: '🐉', kw: 'ejder dragon' },
    { c: '🦅', kw: 'kartal eagle' },
    { c: '🌱', kw: 'fidan plant' },
    { c: '🌊', kw: 'dalga wave deniz' },
    { c: '⚡', kw: 'şimşek lightning' },
    { c: '🌈', kw: 'gökkuşağı rainbow' },
    { c: '☀️', kw: 'güneş sun' },
    { c: '🌙', kw: 'ay moon' },
    { c: '⭐', kw: 'yıldız star' },
  ],
  'Yiyecek': [
    { c: '☕', kw: 'kahve coffee' },
    { c: '🍵', kw: 'çay tea' },
    { c: '🍕', kw: 'pizza' },
    { c: '🍔', kw: 'burger' },
    { c: '🥑', kw: 'avokado avocado' },
    { c: '🍎', kw: 'elma apple' },
    { c: '🍰', kw: 'pasta cake' },
    { c: '🍫', kw: 'çikolata chocolate' },
    { c: '🍺', kw: 'bira beer' },
    { c: '🍷', kw: 'şarap wine' },
  ],
  'Aktivite': [
    { c: '⚽', kw: 'futbol soccer' },
    { c: '🏃', kw: 'koşma run' },
    { c: '🚀', kw: 'roket rocket ship launch' },
    { c: '✈️', kw: 'uçak plane' },
    { c: '🚗', kw: 'araba car' },
    { c: '🚲', kw: 'bisiklet bike' },
    { c: '🎉', kw: 'kutlama party celebrate' },
    { c: '🎁', kw: 'hediye gift' },
    { c: '🎵', kw: 'müzik music' },
    { c: '🎮', kw: 'oyun game' },
    { c: '🏠', kw: 'ev home' },
    { c: '💻', kw: 'laptop bilgisayar' },
    { c: '📱', kw: 'telefon phone' },
    { c: '📦', kw: 'kutu paket package' },
  ],
  'Semboller': [
    { c: '✅', kw: 'tik check yes' },
    { c: '❌', kw: 'çarpı x no' },
    { c: '⚠️', kw: 'uyarı warning' },
    { c: 'ℹ️', kw: 'bilgi info' },
    { c: '🔥', kw: 'ateş fire' },
    { c: '💡', kw: 'fikir idea ampul' },
    { c: '🔒', kw: 'kilit lock güvenlik' },
    { c: '🔓', kw: 'açık unlock' },
    { c: '🔑', kw: 'anahtar key' },
    { c: '🛠', kw: 'tamir tool' },
    { c: '⏰', kw: 'saat alarm clock' },
    { c: '📌', kw: 'iğne pin sabitle' },
    { c: '🔖', kw: 'yer imi bookmark' },
    { c: '🔗', kw: 'link bağlantı' },
    { c: '↻', kw: 'tekrarla repeat' },
    { c: '🔁', kw: 'döngü repost' },
  ],
};

export default function EmojiPicker(props: { onPick: (c: string) => void }) {
  const [open, setOpen] = createSignal(false);
  const [q, setQ] = createSignal('');
  let wrap: HTMLDivElement | undefined;

  // Close on outside-click / Escape
  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      if (!open() || !wrap) return;
      if (!wrap.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    });
  });

  const pick = (c: string) => {
    props.onPick(c);
    setOpen(false);
    setQ('');
  };

  const filtered = (): { name: string; list: Emoji[] }[] => {
    const term = q().trim().toLowerCase();
    return Object.entries(EMOJI).map(([name, list]) => ({
      name,
      list: term
        ? list.filter((e) => e.kw.toLowerCase().includes(term) || e.c.includes(term))
        : list,
    })).filter((g) => g.list.length > 0);
  };

  return (
    <div ref={wrap} style="position: relative; display: inline-block;">
      <button
        type="button"
        class="ghost tiny"
        onClick={() => setOpen((v) => !v)}
        title={t('emoji.title')}
      >
        😀
      </button>
      <Show when={open()}>
        <div
          style="position: absolute; bottom: 100%; left: 0; margin-bottom: 6px; width: 320px; max-height: 320px; background: var(--bg-3); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px; z-index: 30; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); overflow-y: auto;"
        >
          <input
            ref={(el) => setTimeout(() => el?.focus(), 0)}
            type="search"
            placeholder={t('emoji.search_placeholder')}
            value={q()}
            onInput={(e) => setQ(e.currentTarget.value)}
            style="margin-bottom: 8px; font-size: 13px;"
          />
          <For each={filtered()} fallback={<p class="muted tiny">{t('emoji.no_results')}</p>}>
            {(g) => (
              <div style="margin-bottom: 8px;">
                <div class="tiny muted" style="margin-bottom: 4px;">{t('emoji.cat_' + g.name)}</div>
                <div style="display: flex; flex-wrap: wrap; gap: 2px;">
                  <For each={g.list}>
                    {(e) => (
                      <button
                        type="button"
                        onClick={() => pick(e.c)}
                        title={e.kw}
                        style="border: none; background: transparent; font-size: 22px; line-height: 1; padding: 4px; border-radius: 4px; cursor: pointer;"
                        onMouseEnter={(ev) => (ev.currentTarget.style.background = 'var(--bg-2)')}
                        onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
                      >
                        {e.c}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
