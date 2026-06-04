import type { JSX } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { Show, createSignal, createEffect, onCleanup, onMount } from 'solid-js';
import { me, unread, refetchUnread, dmUnread, refetchDmUnread, probeSession, logout } from './auth';
import type { PostView } from './api';
import { t } from './i18n';
import { theme, toggleTheme } from './theme';
import Logo from './components/Logo';
import Compose from './components/Compose';
import Avatar from './components/Avatar';
import ToastStack, { pushToast } from './components/Toast';
import Lightbox from './components/Lightbox';
import HoverCard from './components/HoverCard';
import Shortcuts from './components/Shortcuts';
import CommandPalette, { openPalette } from './components/CommandPalette';
import RightRail from './components/RightRail';

interface NotificationEvent {
  user_id: string;
  kind: string;
  actor_username: string | null;
  target_kind: string;
  target_id: string;
  created_at: string;
}

const eventText = (e: NotificationEvent): string => {
  const who = e.actor_username ?? 'biri';
  switch (e.kind) {
    case 'reaction': return `@${who} postuna tepki verdi`;
    case 'reply':    return `@${who} postuna yanıt verdi`;
    case 'follow':   return `@${who} seni takip etmeye başladı`;
    case 'mention':  return `@${who} seni bahsetti`;
    case 'dm':       return `@${who} mesaj attı`;
    default:         return `@${who}: ${e.kind}`;
  }
};

function SideLink(props: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <A
      href={props.href}
      class={
        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-200 ' +
        (props.active
          ? 'bg-primary/10 text-primary font-semibold'
          : 'text-on-secondary-container hover:bg-surface-container-high/60 hover:text-on-background')
      }
    >
      <span
        class="material-symbols-outlined text-[21px] shrink-0 transition-transform duration-200 group-hover:scale-110"
        style={props.active ? "font-variation-settings: 'FILL' 1;" : ''}
      >
        {props.icon}
      </span>
      <span class="font-mono text-[13.5px] tracking-tight flex-1 min-w-0 truncate">{props.label}</span>
      <Show when={(props.badge ?? 0) > 0}>
        <span class="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-on-primary text-[10px] font-bold flex items-center justify-center leading-none">
          {(props.badge ?? 0) > 99 ? '99+' : props.badge}
        </span>
      </Show>
    </A>
  );
}

function BottomLink(props: { href: string; icon: string; active: boolean }) {
  return (
    <A href={props.href} class={`p-2 ${props.active ? 'text-primary' : 'text-on-surface-variant'}`}>
      <span
        class="material-symbols-outlined"
        style={props.active ? "font-variation-settings: 'FILL' 1;" : ''}
      >
        {props.icon}
      </span>
    </A>
  );
}

export default function Layout(props: { children?: JSX.Element }) {
  const loc = useLocation();
  const is = (p: string) =>
    loc.pathname === p || (p !== '/' && loc.pathname.startsWith(p + '/'));

  // Global compose: the floating turtle button opens this popup; on success
  // we broadcast so the open timeline can prepend the new post.
  const [composeOpen, setComposeOpen] = createSignal(false);
  const onComposed = (p: PostView) => {
    setComposeOpen(false);
    pushToast(t('compose.posted'), 'ok');
    window.dispatchEvent(new CustomEvent('burncpu:posted', { detail: p }));
  };
  // Re-trigger a gentle fade on the main content whenever the route changes.
  let mainRef: HTMLDivElement | undefined;
  createEffect(() => {
    loc.pathname; // track navigation
    const el = mainRef;
    if (!el) return;
    el.classList.remove('route-fade');
    void el.offsetWidth; // force reflow so the animation replays
    el.classList.add('route-fade');
  });

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setComposeOpen(false); };
  // The command palette ("New signal" action) asks Layout to open the composer.
  const onComposeReq = () => setComposeOpen(true);
  onMount(() => {
    window.addEventListener('keydown', onKey);
    window.addEventListener('burncpu:compose', onComposeReq);
    onCleanup(() => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('burncpu:compose', onComposeReq);
    });
  });

  let es: EventSource | undefined;
  let reconnectTimer: number | undefined;
  let backoff = 1000;

  onMount(async () => {
    const ok = await probeSession();
    if (ok) { refetchUnread(); refetchDmUnread(); }
  });

  const connect = () => {
    if (es || !me()) return;
    const src = new EventSource('/api/v1/notifications/stream', { withCredentials: true });
    es = src;
    src.addEventListener('open', () => { backoff = 1000; });
    src.addEventListener('notification', (msg) => {
      try {
        const ev = JSON.parse((msg as MessageEvent).data) as NotificationEvent;
        // Ephemeral "is typing" pings: route to the open DM thread only — no
        // toast, no unread badge, no persistence.
        if (ev.kind === 'typing') {
          window.dispatchEvent(new CustomEvent('burncpu:typing', { detail: ev }));
          return;
        }
        // New public post firehose → the global timeline's live pill. No toast,
        // no unread badge — purely the "N new signals" affordance.
        if (ev.kind === 'new_post') {
          window.dispatchEvent(new CustomEvent('burncpu:newpost', { detail: ev }));
          return;
        }
        pushToast(eventText(ev));
        if (ev.kind !== 'dm') refetchUnread();
        else refetchDmUnread();
        // 19 May 2026 — Sayfa-spesifik real-time refetch icin global event.
        // DMs.tsx ve DMThread.tsx listener ile aktif sayfasi otomatik refresh
        // edebilir. Onceden sadece toast gosteriliyor, liste/thread eski kaliyordu.
        window.dispatchEvent(new CustomEvent('burncpu:notification', { detail: ev }));
      } catch { /* ignore */ }
    });
    // The browser auto-retries transient drops, but once the stream enters
    // CLOSED (server ended it / non-retryable status) it stays dead — and all
    // real-time toasts + DM/notification refetch silently stop. Reconnect with
    // exponential backoff so the live surface survives a server restart.
    src.onerror = () => {
      if (src.readyState === EventSource.CLOSED) {
        src.close();
        if (es === src) es = undefined;
        if (me() && reconnectTimer === undefined) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = undefined;
            backoff = Math.min(backoff * 2, 30000);
            connect();
          }, backoff);
        }
      }
    };
  };

  const disconnect = () => {
    es?.close();
    es = undefined;
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  };

  createEffect(() => {
    if (me()) connect();
    else disconnect();
  });

  onCleanup(disconnect);

  return (
    <div class="min-h-screen bg-background text-on-background">
      {/* ─── Top Nav (full viewport, glassmorphic) ─────── */}
      <nav class="fixed top-0 inset-x-0 z-50 h-16 bg-background/80 backdrop-blur-md border-b border-outline-variant">
        <div class="max-w-[1300px] mx-auto h-full px-4 md:px-6 lg:pl-3 flex justify-between items-center">
          <A href="/" class="flex items-center gap-2.5 group" title="burncpu — 1 vps yeter">
            <Logo size={28} class="shrink-0 logo-flame" />
            <div class="leading-none">
              <div class="font-bold text-[20px] md:text-[22px] tracking-tight">
                <span class="burn-text">burn</span><span class="text-on-background">cpu</span>
              </div>
              <div class="hidden sm:block text-[8px] text-on-surface-variant/70 font-mono tracking-[0.3em] uppercase mt-1">1 vps yeter</div>
            </div>
          </A>

          <div class="hidden md:flex flex-1 max-w-md mx-8">
            <button
              onClick={openPalette}
              aria-label={t('cmd.open')}
              class="relative w-full flex items-center gap-2.5 bg-surface-container/70 border border-outline-variant/70 pl-3.5 pr-2 py-2 rounded-full text-on-surface-variant/70 hover:border-primary/50 hover:bg-surface-container hover:text-on-surface transition-all"
            >
              <span class="material-symbols-outlined shrink-0" style="font-size: 19px;">search</span>
              <span class="flex-1 text-left font-mono text-[13.5px] truncate">{t('nav.search_placeholder')}</span>
              <kbd class="hidden lg:inline-flex items-center shrink-0 px-1.5 h-5 rounded border border-outline-variant bg-surface-container-high font-mono text-[10px] leading-none">⌘K</kbd>
            </button>
          </div>

          <div class="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              class="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
              title={theme() === 'dark' ? t('theme.light') : t('theme.dark')}
            >
              <span class="material-symbols-outlined">{theme() === 'dark' ? 'light_mode' : 'dark_mode'}</span>
            </button>
            <Show when={me()}>
              <button
                onClick={() => setComposeOpen(true)}
                class="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
                title={t('nav.new_post')}
              >
                <span class="material-symbols-outlined">add_box</span>
              </button>
            </Show>
            <A
              href="/notifications"
              class="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors relative"
              title="Bildirimler"
            >
              <span class="material-symbols-outlined">notifications</span>
              <Show when={(unread() ?? 0) > 0}>
                <span class="absolute top-2 right-2 w-2 h-2 bg-primary rounded-full"></span>
              </Show>
            </A>
            <Show
              when={me()}
              fallback={
                <A href="/login" class="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors">
                  <span class="material-symbols-outlined">login</span>
                </A>
              }
            >
              {(u) => (
                <A
                  href={`/u/${u().username}`}
                  class="ml-1 block rounded-lg ring-1 ring-outline-variant/50 hover:ring-2 hover:ring-primary/50 transition-all"
                  title={`@${u().username}`}
                >
                  <Avatar url={u().avatar_url} name={u().display_name} size={30} class="rounded-lg" />
                </A>
              )}
            </Show>
          </div>
        </div>
      </nav>

      {/* ─── Centered shell: sidebar | main | right rail ── */}
      <div class="max-w-[1300px] mx-auto pt-16 min-h-screen">
        <div class="grid grid-cols-1 lg:grid-cols-[256px_minmax(0,1fr)] xl:grid-cols-[256px_minmax(0,1fr)_320px]">
          {/* Left side nav — sticky inside shell */}
          <aside class="hidden lg:flex sticky top-16 h-[calc(100vh-4rem)] flex-col py-5 px-3 border-r border-outline-variant">
            <nav class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 -mr-1 pr-1">
              <p class="px-3 pt-1 pb-1 text-[10px] font-mono uppercase tracking-[0.16em] text-on-surface-variant/45">{t('nav.group.explore')}</p>
              <SideLink href="/"              icon="timeline"      label={t('nav.timeline')}      active={loc.pathname === '/' || loc.pathname === '/feed'} />
              <SideLink href="/search"        icon="search"        label={t('nav.search')}        active={is('/search')} />
              <SideLink href="/notifications" icon="notifications" label={t('nav.notifications')} active={is('/notifications')} badge={unread() ?? 0} />
              <SideLink href="/docs"          icon="menu_book"     label={t('nav.docs')}          active={is('/docs')} />
              <Show when={me()}>
                {(u) => (
                  <>
                    <p class="px-3 pt-4 pb-1 text-[10px] font-mono uppercase tracking-[0.16em] text-on-surface-variant/45">{t('nav.group.account')}</p>
                    <SideLink href="/dm"                       icon="mail"     label={t('nav.dm')}        active={is('/dm')} badge={dmUnread() ?? 0} />
                    <SideLink href={`/u/${u().username}`}      icon="person"   label={t('nav.profile')}   active={is(`/u/${u().username}`)} />
                    <SideLink href="/bookmarks"                icon="bookmark" label={t('nav.bookmarks')} active={is('/bookmarks')} />
                    <SideLink href="/trash"                    icon="delete"   label={t('nav.trash')}     active={is('/trash')} />
                    <SideLink href="/settings"                 icon="settings" label={t('nav.settings')}  active={is('/settings')} />
                    <Show when={u().role === 'admin'}>
                      <SideLink href="/admin" icon="shield" label={t('nav.admin')} active={is('/admin')} />
                    </Show>
                  </>
                )}
              </Show>
            </nav>
            <Show when={me()}>
              {(u) => (
                <div class="mt-auto pt-4 border-t border-outline-variant/30">
                  <div class="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-surface-container-low transition-colors">
                    <A
                      href={`/u/${u().username}`}
                      class="flex items-center gap-2.5 min-w-0 flex-1"
                    >
                      <Avatar url={u().avatar_url} name={u().display_name} size={36} class="rounded-lg" />
                      <div class="min-w-0 leading-tight">
                        <div class="font-bold text-[13px] text-on-background truncate">{u().display_name}</div>
                        <div class="font-mono text-[11px] text-on-surface-variant truncate">@{u().username}</div>
                      </div>
                    </A>
                    <button
                      onClick={() => logout()}
                      title={t('nav.logout')}
                      class="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors shrink-0"
                    >
                      <span class="material-symbols-outlined" style="font-size:18px;">logout</span>
                    </button>
                  </div>
                </div>
              )}
            </Show>
          </aside>

          {/* Main column — bordered both sides where rails exist.
              min-w-0: grid/flex items default to min-width:auto, so a long
              unbreakable token (e.g. a pasted URL) would stretch the column
              past the viewport on mobile. This lets it shrink so text wraps. */}
          <main class="min-w-0 min-h-[calc(100vh-4rem)] py-8 px-4 md:px-8 lg:px-10 xl:px-6 lg:border-r xl:border-r border-outline-variant">
            <div ref={mainRef} class="max-w-[680px] mx-auto route-fade">
              {props.children}
            </div>
          </main>

          {/* Right rail — sticky inside shell */}
          <div class="hidden xl:block">
            <RightRail />
          </div>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <footer class="lg:hidden fixed bottom-0 inset-x-0 bg-background/90 backdrop-blur-md border-t border-outline-variant z-50">
        <div class="flex justify-around items-center h-16">
          <BottomLink href="/"              icon="home"          active={loc.pathname === '/' || loc.pathname === '/feed'} />
          <button onClick={openPalette} aria-label={t('cmd.open')} class="p-2 text-on-surface-variant">
            <span class="material-symbols-outlined">search</span>
          </button>
          <BottomLink href="/notifications" icon="notifications" active={is('/notifications')} />
          <Show when={me()}>
            <BottomLink href="/dm" icon="mail" active={is('/dm')} />
          </Show>
          <Show when={me()} fallback={<BottomLink href="/login" icon="login" active={is('/login')} />}>
            {(u) => <BottomLink href={`/u/${u().username}`} icon="person" active={is(`/u/${u().username}`)} />}
          </Show>
        </div>
      </footer>

      {/* Floating "ignite a signal" compose button — over everything */}
      <Show when={me()}>
        <button
          onClick={() => setComposeOpen(true)}
          title={t('nav.post_signal')}
          aria-label={t('nav.post_signal')}
          class="group fixed right-5 bottom-20 lg:bottom-6 z-[60] w-14 h-14 rounded-full bg-primary shadow-lg shadow-black/30 flex items-center justify-center hover:scale-105 active:scale-90 transition-transform"
        >
          <Logo size={28} class="transition-transform duration-300 group-hover:scale-110 drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]" />
          <span class="absolute -bottom-0.5 -right-0.5 w-[19px] h-[19px] rounded-full bg-background text-primary flex items-center justify-center border border-primary/30 shadow">
            <span class="material-symbols-outlined" style="font-size: 12px;">edit</span>
          </span>
          <span class="pointer-events-none absolute right-[120%] px-2.5 py-1 rounded-lg bg-surface-container-high text-on-surface text-[12px] font-mono whitespace-nowrap border border-outline-variant opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all">
            {t('nav.post_signal')}
          </span>
        </button>
      </Show>

      {/* Compose popup */}
      <Show when={composeOpen()}>
        <div
          class="fixed inset-0 z-[70] flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 pt-20 sm:pt-4 overflow-y-auto"
          onClick={(e) => { if (e.target === e.currentTarget) setComposeOpen(false); }}
        >
          <div class="w-full max-w-[600px]">
            <div class="flex items-center justify-between mb-2 px-1">
              <h3 class="text-on-background font-bold flex items-center gap-2">
                <Logo size={18} /> {t('nav.post_signal')}
              </h3>
              <button
                onClick={() => setComposeOpen(false)}
                aria-label="close"
                class="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
              >
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>
            <Compose autofocus onPosted={onComposed} onPending={() => setComposeOpen(false)} />
          </div>
        </div>
      </Show>

      <ToastStack />
      <Lightbox />
      <HoverCard />
      <Shortcuts />
      <CommandPalette />
    </div>
  );
}
