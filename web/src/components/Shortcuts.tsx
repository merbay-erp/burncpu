// Global keyboard shortcuts. Skipped when focus is in an input, textarea
// or contenteditable element so users can type the letters naturally.
//
//   n         → focus first composer textarea (or navigate Home)
//   g h       → home, g f → feed, g n → notifications, g s → search
//   j         → next .post into view
//   k         → previous .post into view
//   ?         → show shortcut help modal
//   Esc       → close help modal

import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';

const [helpOpen, setHelpOpen] = createSignal(false);

export default function Shortcuts() {
  const nav = useNavigate();
  let gPending = false;
  let gTimer: ReturnType<typeof setTimeout> | undefined;

  const inEditable = (e: KeyboardEvent): boolean => {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  };

  const visiblePosts = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>('article.post'));

  const focusedIndex = (): number => {
    const posts = visiblePosts();
    const y = window.scrollY + 100; // slight offset so the topmost-visible counts
    let idx = 0;
    for (let i = 0; i < posts.length; i++) {
      const top = posts[i].getBoundingClientRect().top + window.scrollY;
      if (top <= y) idx = i;
      else break;
    }
    return idx;
  };

  const scrollTo = (el: HTMLElement) => {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      // Allow `Esc` to close help even if focus is in a field
      if (e.key === 'Escape' && helpOpen()) {
        setHelpOpen(false);
        return;
      }
      if (inEditable(e)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // `g` prefix: wait up to 800ms for second key
      if (e.key === 'g' && !gPending) {
        gPending = true;
        if (gTimer) clearTimeout(gTimer);
        gTimer = setTimeout(() => { gPending = false; }, 800);
        return;
      }
      if (gPending) {
        gPending = false;
        if (gTimer) clearTimeout(gTimer);
        switch (e.key) {
          case 'h': nav('/'); break;
          case 'f': nav('/feed'); break;
          case 'n': nav('/notifications'); break;
          case 's': nav('/search'); break;
          case 'b': nav('/bookmarks'); break;
          case 't': nav('/trending'); break;
          case 'd': nav('/dm'); break;
          default: return;
        }
        e.preventDefault();
        return;
      }

      switch (e.key) {
        case 'n': {
          const ta = document.querySelector<HTMLTextAreaElement>('.compose textarea');
          if (ta) {
            e.preventDefault();
            ta.focus();
          } else {
            nav('/');
          }
          break;
        }
        case 'j': {
          e.preventDefault();
          const posts = visiblePosts();
          const next = posts[Math.min(focusedIndex() + 1, posts.length - 1)];
          if (next) scrollTo(next);
          break;
        }
        case 'k': {
          e.preventDefault();
          const posts = visiblePosts();
          const prev = posts[Math.max(focusedIndex() - 1, 0)];
          if (prev) scrollTo(prev);
          break;
        }
        case '?': {
          e.preventDefault();
          setHelpOpen(true);
          break;
        }
      }
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  return (
    <Show when={helpOpen()}>
      <div
        onClick={() => setHelpOpen(false)}
        style="position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 9997; padding: 20px;"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style="background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 22px; max-width: 420px; width: 100%;"
        >
          <h3 style="margin-top: 0;">Klavye kısayolları</h3>
          <table style="width: 100%; font-size: 13px;">
            <tbody>
              <Row k="n" desc="Yeni post (composer odakla)" />
              <Row k="j / k" desc="Sonraki / önceki post" />
              <Row k="g h" desc="Public timeline" />
              <Row k="g f" desc="Feed" />
              <Row k="g n" desc="Bildirimler" />
              <Row k="g s" desc="Ara" />
              <Row k="g b" desc="Kayıtlılar" />
              <Row k="g t" desc="Trend" />
              <Row k="g d" desc="Mesajlar" />
              <Row k="?" desc="Bu yardımı aç/kapat" />
              <Row k="Esc" desc="Kapat" />
            </tbody>
          </table>
          <p class="muted tiny" style="margin-bottom: 0;">
            Compose'daki ⌘/Ctrl+Enter — DM/yorum gönder.
          </p>
        </div>
      </div>
    </Show>
  );
}

function Row(props: { k: string; desc: string }) {
  return (
    <tr>
      <td style="padding: 4px 8px;">
        <kbd>{props.k}</kbd>
      </td>
      <td style="padding: 4px 8px; color: var(--fg-2);">{props.desc}</td>
    </tr>
  );
}
