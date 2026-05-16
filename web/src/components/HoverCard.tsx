// Document-level @username hover card. Listens for hover on any
// `<a href="/u/...">` and pops a small profile card. Uses fetch+cache so
// the same hover doesn't refetch.
//
// Mount once at app root.

import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { api, type Profile } from '../api';

interface CardState {
  username: string;
  x: number;
  y: number;
  profile: Profile | null;
  loading: boolean;
}

const cache = new Map<string, Profile>();
const [card, setCard] = createSignal<CardState | null>(null);

const HIDE_DELAY = 250;
const SHOW_DELAY = 350;

export default function HoverCard() {
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let showTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    if (hideTimer) clearTimeout(hideTimer);
    if (showTimer) clearTimeout(showTimer);
    hideTimer = undefined;
    showTimer = undefined;
  };

  const scheduleHide = () => {
    clearTimers();
    hideTimer = setTimeout(() => setCard(null), HIDE_DELAY);
  };

  onMount(() => {
    const onOver = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest('a') as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      const m = /^\/u\/([a-z0-9_]{3,32})$/.exec(href);
      if (!m) return;
      const username = m[1];
      clearTimers();
      const rect = a.getBoundingClientRect();
      const x = rect.left + window.scrollX;
      const y = rect.bottom + window.scrollY + 4;

      const cached = cache.get(username);
      showTimer = setTimeout(async () => {
        setCard({ username, x, y, profile: cached ?? null, loading: !cached });
        if (!cached) {
          try {
            const p = await api.get<Profile>(`/users/${username}`);
            cache.set(username, p);
            setCard((cur) =>
              cur && cur.username === username
                ? { ...cur, profile: p, loading: false }
                : cur,
            );
          } catch {
            setCard((cur) =>
              cur && cur.username === username ? { ...cur, loading: false } : cur,
            );
          }
        }
      }, SHOW_DELAY);
    };

    const onOut = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest('a');
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      if (!/^\/u\//.test(href)) return;
      scheduleHide();
    };

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    onCleanup(() => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      clearTimers();
    });
  });

  return (
    <Show when={card()}>
      {(c) => (
        <div
          onMouseEnter={() => clearTimers()}
          onMouseLeave={scheduleHide}
          style={`position: absolute; top: ${c().y}px; left: ${c().x}px; min-width: 240px; max-width: 320px; background: var(--bg-3); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 50; font-size: 13px;`}
        >
          <Show when={c().loading}>
            <div class="muted tiny">@{c().username} yükleniyor…</div>
          </Show>
          <Show when={c().profile}>
            {(p) => (
              <>
                <div class="flex" style="align-items: center; gap: 10px;">
                  <Show when={p().avatar_url} fallback={
                    <div style="width: 38px; height: 38px; border-radius: 50%; background: var(--accent); color: #1a0a00; display: flex; align-items: center; justify-content: center; font-weight: 700;">
                      {p().username[0]?.toUpperCase()}
                    </div>
                  }>
                    <img
                      src={p().avatar_url!}
                      alt=""
                      style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover;"
                    />
                  </Show>
                  <div style="flex: 1;">
                    <div style="font-weight: 600;">{p().display_name}</div>
                    <div class="handle muted">@{p().username}</div>
                  </div>
                </div>
                <Show when={p().bio}>
                  <div style="margin-top: 8px; color: var(--fg);">{p().bio}</div>
                </Show>
                <div class="tiny muted" style="margin-top: 8px;">
                  <strong style="color: var(--fg);">{p().counts.posts}</strong> post ·{' '}
                  <strong style="color: var(--fg);">{p().counts.followers}</strong> takipçi ·{' '}
                  <strong style="color: var(--fg);">{p().counts.following}</strong> takip
                </div>
              </>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}
