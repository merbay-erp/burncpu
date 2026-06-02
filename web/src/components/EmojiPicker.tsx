// Tiny built-in emoji picker. Curated ~120 common emoji across categories;
// no external library. Searchable by keyword (English + Turkish). Click
// to insert. Toggle from any composer with a single button.
//
// The panel renders in a Portal with fixed positioning so it can never be
// clipped by an ancestor's overflow (the composer toolbar scrolls on the
// x-axis, which used to clip the upward popup to a sliver).

import { createSignal, createEffect, For, Show, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
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

const PANEL_W = 320;

export default function EmojiPicker(props: { onPick: (c: string) => void }) {
  const [open, setOpen] = createSignal(false);
  const [q, setQ] = createSignal('');
  const [posStyle, setPosStyle] = createSignal('left:0;top:0');
  let trigger: HTMLButtonElement | undefined;
  let panel: HTMLDivElement | undefined;

  const reposition = () => {
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8));
    // Open upward when the button sits in the lower half of the viewport
    // (it almost always does — the composer toolbar is near the bottom).
    const openUp = r.top > window.innerHeight / 2;
    const vertical = openUp
      ? `bottom:${Math.round(window.innerHeight - r.top + 8)}px`
      : `top:${Math.round(r.bottom + 8)}px`;
    setPosStyle(`left:${Math.round(left)}px;${vertical}`);
  };

  // Reposition while open; follow scroll/resize so the panel tracks the button.
  createEffect(() => {
    if (!open()) return;
    reposition();
    const onMove = () => reposition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    onCleanup(() => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    });
  });

  // Close on outside-click / Escape. The panel is portaled to <body>, so the
  // outside check must consider both the trigger and the panel.
  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      if (!open()) return;
      const target = e.target as Node;
      if (trigger?.contains(target) || panel?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
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
    <>
      <button
        ref={trigger}
        type="button"
        class="shrink-0 p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors"
        classList={{ 'text-primary bg-surface-container-high': open() }}
        onClick={() => setOpen((v) => !v)}
        title={t('emoji.title')}
        aria-label={t('emoji.title')}
      >
        <span class="material-symbols-outlined" style="font-size:20px;">mood</span>
      </button>

      <Show when={open()}>
        <Portal>
          <div
            ref={panel}
            class="fixed z-[130] w-80 max-h-[340px] overflow-y-auto bg-surface-container-high border border-outline-variant rounded-xl shadow-2xl shadow-black/40 p-2 cmdk-panel"
            style={posStyle()}
          >
            <input
              ref={(el) => requestAnimationFrame(() => el?.focus({ preventScroll: true }))}
              type="search"
              placeholder={t('emoji.search_placeholder')}
              value={q()}
              onInput={(e) => setQ(e.currentTarget.value)}
              class="w-full mb-2 px-3 py-2 rounded-lg bg-background border border-outline-variant text-on-surface text-[13px] placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <For
              each={filtered()}
              fallback={<p class="text-on-surface-variant font-mono text-[12px] px-1 py-3 text-center">{t('emoji.no_results')}</p>}
            >
              {(g) => (
                <div class="mb-2">
                  <div class="text-[10px] uppercase tracking-widest font-mono text-on-surface-variant/70 mb-1 px-1">
                    {t('emoji.cat_' + g.name)}
                  </div>
                  <div class="flex flex-wrap gap-0.5">
                    <For each={g.list}>
                      {(e) => (
                        <button
                          type="button"
                          onClick={() => pick(e.c)}
                          title={e.kw}
                          class="text-[22px] leading-none p-1.5 rounded-lg hover:bg-surface-container-highest transition-colors"
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
        </Portal>
      </Show>
    </>
  );
}
