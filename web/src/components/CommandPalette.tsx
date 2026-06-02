// ⌘K command palette — instant navigation, quick actions and live search
// (people + posts) in one keyboard-driven surface. Opened with ⌘K / Ctrl+K,
// by clicking the top-nav search bar, or the mobile search tab.

import {
  createSignal, createMemo, createResource, createEffect, For, Show, onMount, onCleanup,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { api, type SearchResponse } from '../api';
import { me } from '../auth';
import { toggleTheme } from '../theme';
import { t } from '../i18n';
import Avatar from './Avatar';

export const [paletteOpen, setPaletteOpen] = createSignal(false);
export function openPalette() { setPaletteOpen(true); }

interface UserBrief { id: string; username: string; display_name: string; avatar_url: string | null }
interface CmdItem {
  key: string;
  label: string;
  sub?: string;
  icon?: string;
  avatar?: { url: string | null; name: string };
  badge?: string;
  run: () => void;
}
interface CmdGroup { title: string; items: CmdItem[] }

function excerpt(body: string): string {
  const s = body.replace(/\s+/g, ' ').trim();
  return s.length > 72 ? s.slice(0, 72) + '…' : s;
}

function Kbd(props: { children: string }) {
  return (
    <kbd class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded border border-outline-variant bg-surface-container text-on-surface-variant font-mono text-[10px] leading-none">
      {props.children}
    </kbd>
  );
}

export default function CommandPalette() {
  const nav = useNavigate();
  const [query, setQuery] = createSignal('');
  const [dq, setDq] = createSignal(''); // debounced
  const [selected, setSelected] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const close = () => setPaletteOpen(false);
  const go = (path: string) => { close(); nav(path); };

  // debounce raw query → dq, and reset selection on every keystroke
  createEffect(() => {
    const q = query();
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { setDq(q.trim()); setSelected(0); }, 170);
  });

  // open/close side-effects: focus, reset, scroll-lock
  createEffect(() => {
    if (paletteOpen()) {
      setQuery(''); setDq(''); setSelected(0);
      queueMicrotask(() => inputRef?.focus());
      document.documentElement.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
    }
  });

  // global ⌘K / Ctrl+K toggles the palette from anywhere
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });
  onCleanup(() => { document.documentElement.style.overflow = ''; });

  const canSearch = () => paletteOpen() && dq().length >= 2;

  const [people] = createResource(
    () => (canSearch() ? dq() : null),
    async (q: string) => {
      try { return await api.get<UserBrief[]>(`/users/lookup?prefix=${encodeURIComponent(q.replace(/^@/, ''))}&limit=6`); }
      catch { return [] as UserBrief[]; }
    },
  );
  const [posts] = createResource(
    () => (canSearch() ? dq() : null),
    async (q: string) => {
      try { return (await api.get<SearchResponse>(`/search?q=${encodeURIComponent(q)}&limit=5`)).hits; }
      catch { return []; }
    },
  );

  const actionItems = (): CmdItem[] => {
    const u = me();
    const items: CmdItem[] = [];
    if (u) items.push({
      key: 'act-compose', icon: 'edit_square', label: t('cmd.compose'), badge: 'N',
      run: () => { close(); window.dispatchEvent(new CustomEvent('burncpu:compose')); },
    });
    items.push({ key: 'act-theme', icon: 'contrast', label: t('cmd.theme'), run: () => { toggleTheme(); close(); } });
    return items;
  };

  const navItems = (): CmdItem[] => {
    const u = me();
    const items: CmdItem[] = [
      { key: 'go-timeline', icon: 'timeline', label: t('nav.timeline'), sub: t('nav.tab_global'), run: () => go('/') },
      { key: 'go-feed', icon: 'dynamic_feed', label: t('nav.tab_personal'), run: () => go('/feed') },
      { key: 'go-trending', icon: 'trending_up', label: t('trending.title'), run: () => go('/trending') },
      { key: 'go-search', icon: 'search', label: t('nav.search'), run: () => go('/search') },
      { key: 'go-notif', icon: 'notifications', label: t('nav.notifications'), run: () => go('/notifications') },
      { key: 'go-docs', icon: 'menu_book', label: t('nav.docs'), run: () => go('/docs') },
    ];
    if (u) {
      items.push(
        { key: 'go-dm', icon: 'mail', label: t('nav.dm'), run: () => go('/dm') },
        { key: 'go-bookmarks', icon: 'bookmark', label: t('nav.bookmarks'), run: () => go('/bookmarks') },
        { key: 'go-profile', icon: 'person', label: t('nav.profile'), sub: '@' + u.username, run: () => go(`/u/${u.username}`) },
        { key: 'go-settings', icon: 'settings', label: t('nav.settings'), run: () => go('/settings') },
      );
    }
    return items;
  };

  const match = (label: string, q: string) => label.toLowerCase().includes(q.toLowerCase());

  const groups = createMemo<CmdGroup[]>(() => {
    const q = dq();
    const out: CmdGroup[] = [];
    if (!q) {
      const a = actionItems();
      if (a.length) out.push({ title: t('cmd.group.actions'), items: a });
      out.push({ title: t('cmd.group.nav'), items: navItems() });
      return out;
    }
    const navM = [...actionItems(), ...navItems()].filter((i) => match(i.label, q) || (i.sub && match(i.sub, q)));
    if (navM.length) out.push({ title: t('cmd.group.nav'), items: navM });

    const ppl = (people() ?? []).map<CmdItem>((u) => ({
      key: 'ppl-' + u.id, label: u.display_name || u.username, sub: '@' + u.username,
      avatar: { url: u.avatar_url, name: u.display_name || u.username }, run: () => go(`/u/${u.username}`),
    }));
    if (ppl.length) out.push({ title: t('cmd.group.people'), items: ppl });

    const pst = (posts() ?? []).map<CmdItem>((h) => ({
      key: 'pst-' + h.id, icon: 'tag', label: excerpt(h.body), sub: '@' + h.author_username, run: () => go(`/posts/${h.id}`),
    }));
    if (pst.length) out.push({ title: t('cmd.group.posts'), items: pst });
    return out;
  });

  // groups annotated with a running global index, for keyboard selection
  const indexed = createMemo(() => {
    let i = 0;
    return groups().map((g) => ({ title: g.title, items: g.items.map((it) => ({ it, idx: i++ })) }));
  });
  const flat = createMemo<CmdItem[]>(() => groups().flatMap((g) => g.items));
  const loading = () => canSearch() && (people.loading || posts.loading);

  // keep selection in range
  createEffect(() => { const n = flat().length; if (selected() >= n) setSelected(n ? n - 1 : 0); });

  const scrollSel = () => queueMicrotask(() => {
    listRef?.querySelector('[data-sel="true"]')?.scrollIntoView({ block: 'nearest' });
  });

  const onInputKey = (e: KeyboardEvent) => {
    const items = flat();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => Math.min(i + 1, items.length - 1)); scrollSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => Math.max(i - 1, 0)); scrollSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); items[selected()]?.run(); }
  };

  return (
    <Show when={paletteOpen()}>
      <div
        class="fixed inset-0 z-[120] flex items-start justify-center px-4 pt-[14vh] bg-black/50 backdrop-blur-sm cmdk-overlay"
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      >
        <div class="w-full max-w-[580px] bg-surface-container-high/95 backdrop-blur-xl border border-outline-variant rounded-2xl shadow-2xl shadow-black/40 overflow-hidden cmdk-panel">
          {/* Search row */}
          <div class="flex items-center gap-3 px-4 h-14 border-b border-outline-variant/70">
            <span
              class="material-symbols-outlined text-primary shrink-0"
              classList={{ 'animate-spin': loading() }}
              style="font-size: 22px;"
            >
              {loading() ? 'progress_activity' : 'search'}
            </span>
            <input
              ref={inputRef}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={onInputKey}
              placeholder={t('cmd.placeholder')}
              autocomplete="off"
              spellcheck={false}
              class="flex-1 bg-transparent border-0 outline-none text-on-background text-[15px] placeholder:text-on-surface-variant/60"
            />
            <button onClick={close} class="shrink-0"><Kbd>esc</Kbd></button>
          </div>

          {/* Results */}
          <div ref={listRef} class="max-h-[52vh] overflow-y-auto px-2 py-2">
            <Show
              when={flat().length > 0}
              fallback={
                <div class="px-4 py-10 text-center text-on-surface-variant font-mono text-[13px]">
                  {loading() ? t('cmd.searching') : t('cmd.empty')}
                </div>
              }
            >
              <For each={indexed()}>
                {(group) => (
                  <div class="mb-1">
                    <div class="px-2 pt-2 pb-1 font-mono text-[10.5px] uppercase tracking-widest text-on-surface-variant/80">
                      {group.title}
                    </div>
                    <For each={group.items}>
                      {(row) => {
                        const isSel = () => row.idx === selected();
                        return (
                          <button
                            data-sel={isSel()}
                            onMouseMove={() => setSelected(row.idx)}
                            onClick={() => row.it.run()}
                            class="w-full flex items-center gap-3 px-2 py-2 rounded-xl text-left transition-colors"
                            classList={{ 'bg-primary/12': isSel(), 'hover:bg-surface-container': !isSel() }}
                          >
                            <Show
                              when={row.it.avatar}
                              fallback={
                                <span
                                  class="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center material-symbols-outlined"
                                  classList={{ 'bg-primary/15 text-primary': isSel(), 'bg-surface-container text-on-surface-variant': !isSel() }}
                                  style="font-size: 20px;"
                                >
                                  {row.it.icon ?? 'chevron_right'}
                                </span>
                              }
                            >
                              {(av) => <Avatar url={av().url} name={av().name} size={36} class="rounded-lg" />}
                            </Show>
                            <span class="min-w-0 flex-1">
                              <span class="block truncate text-on-background text-[14px]">{row.it.label}</span>
                              <Show when={row.it.sub}>
                                <span class="block truncate text-on-surface-variant text-[12px] font-mono">{row.it.sub}</span>
                              </Show>
                            </span>
                            <Show when={row.it.badge && !isSel()}>
                              <Kbd>{row.it.badge!}</Kbd>
                            </Show>
                            <Show when={isSel()}>
                              <span class="material-symbols-outlined text-primary shrink-0" style="font-size: 18px;">subdirectory_arrow_left</span>
                            </Show>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>

          {/* Footer hints */}
          <div class="flex items-center justify-between px-4 h-10 border-t border-outline-variant/70 text-on-surface-variant">
            <span class="flex items-center gap-1.5 font-mono text-[11px]">
              <span class="text-primary font-bold">burn</span>cpu
            </span>
            <span class="flex items-center gap-3 text-[11px] font-mono">
              <span class="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> {t('cmd.hint.nav')}</span>
              <span class="flex items-center gap-1"><Kbd>↵</Kbd> {t('cmd.hint.open')}</span>
              <span class="flex items-center gap-1"><Kbd>esc</Kbd> {t('cmd.hint.close')}</span>
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
}
