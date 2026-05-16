import type { JSX } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { Show, createEffect, onCleanup, onMount } from 'solid-js';
import { me, unread, refetchUnread, probeSession, logout } from './auth';
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

// SideNav item — controlled active styling per design ref
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
    <A
      href={props.href}
      class={`p-2 ${props.active ? 'text-primary' : 'text-on-surface-variant'}`}
    >
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

  onMount(async () => {
    const ok = await probeSession();
    if (ok) refetchUnread();
  });

  createEffect(() => {
    if (me()) {
      if (!es) {
        es = new EventSource('/api/v1/notifications/stream', { withCredentials: true });
        es.addEventListener('notification', (msg) => {
          try {
            const ev = JSON.parse((msg as MessageEvent).data) as NotificationEvent;
            pushToast(eventText(ev));
            if (ev.kind !== 'dm') refetchUnread();
          } catch { /* ignore */ }
        });
      }
    } else {
      es?.close();
      es = undefined;
    }
  });

  onCleanup(() => es?.close());

  return (
    <div class="min-h-screen bg-background text-on-background">
      {/* ─── Top Nav (glassmorphic, fixed) ─────────────── */}
      <nav class="fixed top-0 inset-x-0 z-50 flex justify-between items-center px-margin-mobile md:px-gutter h-16 bg-background/80 backdrop-blur-md border-b border-outline-variant">
        <A href="/" class="flex items-center gap-2">
          <span class="font-headline-lg text-[20px] md:text-[24px] font-bold tracking-tighter text-primary">🐢 BURNCPU</span>
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
              placeholder="Search the signal..."
              class="w-full bg-surface-container border border-outline-variant pl-10 pr-3 py-2 rounded-lg font-mono text-[14px] focus:outline-none focus:border-primary transition-colors"
            />
          </form>
        </div>

        <div class="flex items-center gap-base">
          <Show when={me()}>
            <button
              onClick={() => {
                const ta = document.querySelector<HTMLTextAreaElement>('.composer textarea');
                if (ta) ta.focus(); else window.location.assign('/');
              }}
              class="p-2 text-on-surface-variant hover:text-primary transition-colors active:scale-95 duration-150"
              title="Yeni post"
            >
              <span class="material-symbols-outlined">add_box</span>
            </button>
          </Show>
          <A
            href="/notifications"
            class="p-2 text-on-surface-variant hover:text-primary transition-colors active:scale-95 duration-150 relative"
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
                class="p-2 text-on-surface-variant hover:text-primary transition-colors active:scale-95 duration-150"
                title={`@${u().username}`}
              >
                <span class="material-symbols-outlined">account_circle</span>
              </A>
            )}
          </Show>
        </div>
      </nav>

      {/* ─── Side Nav (desktop only) ───────────────────── */}
      <aside class="hidden lg:flex fixed left-0 top-16 h-[calc(100vh-64px)] w-64 flex-col py-8 px-4 gap-base border-r border-outline-variant bg-background">
        <div class="mb-6 px-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-surface-container-highest flex items-center justify-center text-[24px]">🐢</div>
            <div>
              <div class="font-mono text-[14px] text-primary font-bold">BurnCPU</div>
              <div class="text-[10px] text-on-surface-variant font-mono">1 VPS IS ENOUGH</div>
            </div>
          </div>
        </div>
        <nav class="flex flex-col gap-1">
          <SideLink href="/"             icon="timeline"     label="Timeline"      active={loc.pathname === '/'} />
          <SideLink href="/feed"         icon="rss_feed"     label="Feed"          active={is('/feed')} />
          <SideLink href="/search"       icon="search"       label="Search"        active={is('/search')} />
          <SideLink href="/notifications" icon="notifications" label="Notifications" active={is('/notifications')} />
          <Show when={me()}>
            {(u) => (
              <>
                <SideLink href="/dm"        icon="mail"      label="DM"        active={is('/dm')} />
                <SideLink href={`/u/${u().username}`} icon="person" label="Profile" active={is(`/u/${u().username}`)} />
                <SideLink href="/bookmarks" icon="bookmark"  label="Saved"     active={is('/bookmarks')} />
                <SideLink href="/trash"     icon="delete"    label="Trash"     active={is('/trash')} />
                <SideLink href="/settings"  icon="settings"  label="Settings"  active={is('/settings')} />
                <Show when={u().role === 'admin'}>
                  <SideLink href="/admin" icon="shield" label="Admin" active={is('/admin')} />
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
                  Çıkış
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
                Post Signal
              </button>
            </>
          )}
        </Show>
      </aside>

      {/* ─── Main + Right Rail ──────────────────────────── */}
      <main class="pt-20 pb-20 lg:pl-64 xl:pr-[320px] min-h-screen">
        <div class="max-w-content-width mx-auto px-margin-mobile md:px-0">
          {props.children}
        </div>
      </main>

      <RightRail />

      {/* ─── Mobile bottom nav ────────────────────────── */}
      <footer class="lg:hidden fixed bottom-0 inset-x-0 bg-background/90 backdrop-blur-md border-t border-outline-variant z-50">
        <div class="flex justify-around items-center h-16">
          <BottomLink href="/"             icon="home"          active={loc.pathname === '/'} />
          <BottomLink href="/search"       icon="search"        active={is('/search')} />
          <BottomLink href="/feed"         icon="rss_feed"      active={is('/feed')} />
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
