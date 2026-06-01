import type { JSX } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { Show, createEffect, onCleanup, onMount } from 'solid-js';
import { me, unread, refetchUnread, probeSession, logout } from './auth';
import { t } from './i18n';
import Logo from './components/Logo';
import ToastStack, { pushToast } from './components/Toast';
import Lightbox from './components/Lightbox';
import HoverCard from './components/HoverCard';
import Shortcuts from './components/Shortcuts';
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

function SideLink(props: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <A
      href={props.href}
      class={
        props.active
          ? 'flex items-center gap-3 px-4 py-3 text-primary border-r-2 border-primary bg-surface-container-low font-bold transition-all duration-200'
          : 'flex items-center gap-3 px-4 py-3 text-on-secondary-container hover:bg-surface-container-highest hover:text-primary transition-all duration-200'
      }
    >
      <span class="material-symbols-outlined">{props.icon}</span>
      <span class="font-mono text-[14px] tracking-wide">{props.label}</span>
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
  let es: EventSource | undefined;
  let reconnectTimer: number | undefined;
  let backoff = 1000;

  onMount(async () => {
    const ok = await probeSession();
    if (ok) refetchUnread();
  });

  const connect = () => {
    if (es || !me()) return;
    const src = new EventSource('/api/v1/notifications/stream', { withCredentials: true });
    es = src;
    src.addEventListener('open', () => { backoff = 1000; });
    src.addEventListener('notification', (msg) => {
      try {
        const ev = JSON.parse((msg as MessageEvent).data) as NotificationEvent;
        pushToast(eventText(ev));
        if (ev.kind !== 'dm') refetchUnread();
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
        <div class="max-w-[1300px] mx-auto h-full px-4 md:px-6 flex justify-between items-center">
          <A href="/" class="flex items-center gap-2.5 group" title="burncpu — 1 vps yeter">
            <Logo size={26} class="text-primary shrink-0 transition-transform duration-300 group-hover:-rotate-6" />
            <span class="font-bold text-[20px] md:text-[22px] tracking-tight leading-none text-on-background">
              burncpu
            </span>
          </A>

          <div class="hidden md:flex flex-1 max-w-md mx-8">
            <form
              class="relative w-full"
              onSubmit={(e) => {
                e.preventDefault();
                const v = (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.value?.trim();
                if (v) window.location.assign(`/search?q=${encodeURIComponent(v)}`);
              }}
            >
              <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" style="font-size: 20px;">search</span>
              <input
                type="text"
                placeholder={t('nav.search_placeholder')}
                class="w-full bg-surface-container border border-outline-variant pl-10 pr-3 py-2 rounded-lg font-mono text-[14px] focus:outline-none focus:border-primary transition-colors"
              />
            </form>
          </div>

          <div class="flex items-center gap-2">
            <Show when={me()}>
              <button
                onClick={() => {
                  const ta = document.querySelector<HTMLTextAreaElement>('.composer textarea');
                  if (ta) ta.focus(); else window.location.assign('/');
                }}
                class="p-2 text-on-surface-variant hover:text-primary transition-colors"
                title="Yeni post"
              >
                <span class="material-symbols-outlined">add_box</span>
              </button>
            </Show>
            <A
              href="/notifications"
              class="p-2 text-on-surface-variant hover:text-primary transition-colors relative"
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
                <A href="/login" class="p-2 text-on-surface-variant hover:text-primary">
                  <span class="material-symbols-outlined">login</span>
                </A>
              }
            >
              {(u) => (
                <A
                  href={`/u/${u().username}`}
                  class="p-2 text-on-surface-variant hover:text-primary transition-colors"
                  title={`@${u().username}`}
                >
                  <span class="material-symbols-outlined">account_circle</span>
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
          <aside class="hidden lg:flex sticky top-16 h-[calc(100vh-4rem)] flex-col py-8 px-4 gap-base border-r border-outline-variant">
            <div class="mb-6 px-4">
              <div class="flex items-center gap-3">
                <Logo size={32} class="text-primary shrink-0" />
                <div class="leading-tight">
                  <div class="font-bold text-[16px] tracking-tight text-on-background">burncpu</div>
                  <div class="text-[10px] text-on-surface-variant font-mono tracking-wider">1 vps yeter</div>
                </div>
              </div>
            </div>
            <nav class="flex flex-col gap-1">
              <SideLink href="/"              icon="timeline"      label={t('nav.timeline')}      active={loc.pathname === '/'} />
              <SideLink href="/feed"          icon="rss_feed"      label={t('nav.feed')}          active={is('/feed')} />
              <SideLink href="/search"        icon="search"        label={t('nav.search')}        active={is('/search')} />
              <SideLink href="/notifications" icon="notifications" label={t('nav.notifications')} active={is('/notifications')} />
              <Show when={me()}>
                {(u) => (
                  <>
                    <SideLink href="/dm"                       icon="mail"     label={t('nav.dm')}        active={is('/dm')} />
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
                <>
                  <div class="mt-auto pt-6 border-t border-outline-variant/30 px-4">
                    <div class="font-mono text-[12px] text-on-surface-variant truncate">@{u().username}</div>
                    <button
                      onClick={() => logout()}
                      class="font-mono text-[11px] text-on-surface-variant hover:text-primary mt-1"
                    >
                      {t('nav.logout')}
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      const ta = document.querySelector<HTMLTextAreaElement>('.composer textarea');
                      if (ta) ta.focus(); else window.location.assign('/');
                    }}
                    class="w-full bg-primary text-on-primary font-bold py-3 rounded-lg flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all"
                  >
                    <span class="material-symbols-outlined">add</span>
                    {t('nav.post_signal')}
                  </button>
                </>
              )}
            </Show>
          </aside>

          {/* Main column — bordered both sides where rails exist */}
          <main class="min-h-[calc(100vh-4rem)] py-8 px-4 md:px-8 lg:px-10 xl:px-6 lg:border-r xl:border-r border-outline-variant">
            <div class="max-w-[680px] mx-auto">
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
          <BottomLink href="/"              icon="home"          active={loc.pathname === '/'} />
          <BottomLink href="/search"        icon="search"        active={is('/search')} />
          <BottomLink href="/feed"          icon="rss_feed"      active={is('/feed')} />
          <BottomLink href="/notifications" icon="notifications" active={is('/notifications')} />
          <Show when={me()} fallback={<BottomLink href="/login" icon="login" active={is('/login')} />}>
            {(u) => <BottomLink href={`/u/${u().username}`} icon="person" active={is(`/u/${u().username}`)} />}
          </Show>
        </div>
      </footer>

      <ToastStack />
      <Lightbox />
      <HoverCard />
      <Shortcuts />
    </div>
  );
}
