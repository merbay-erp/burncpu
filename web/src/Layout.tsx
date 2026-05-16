import type { JSX } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { Show, createEffect, onCleanup, onMount } from 'solid-js';
import { me, unread, refetchUnread, probeSession, logout } from './auth';
import ToastStack, { pushToast } from './components/Toast';

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
    case 'reaction':
      return `@${who} postuna tepki verdi`;
    case 'reply':
      return `@${who} postuna yanıt verdi`;
    case 'follow':
      return `@${who} seni takip etmeye başladı`;
    case 'mention':
      return `@${who} seni bahsetti`;
    default:
      return `@${who}: ${e.kind}`;
  }
};

export default function Layout(props: { children?: JSX.Element }) {
  const loc = useLocation();
  const isActive = (p: string) => (loc.pathname === p ? 'active' : '');
  let es: EventSource | undefined;

  onMount(async () => {
    const ok = await probeSession();
    if (ok) refetchUnread();
  });

  // Open the SSE stream whenever we transition into a logged-in state;
  // close it on logout. createEffect re-runs when me() changes.
  createEffect(() => {
    if (me()) {
      if (!es) {
        es = new EventSource('/api/v1/notifications/stream', { withCredentials: true });
        es.addEventListener('notification', (msg) => {
          try {
            const ev = JSON.parse((msg as MessageEvent).data) as NotificationEvent;
            pushToast(eventText(ev));
            refetchUnread();
          } catch {
            // ignore malformed
          }
        });
        es.onerror = () => {
          // Browser will auto-reconnect with the same connection — let it.
        };
      }
    } else {
      es?.close();
      es = undefined;
    }
  });

  onCleanup(() => es?.close());

  return (
    <div class="shell">
      <nav class="nav">
        <A href="/" class="brand">
          burncpu
          <small>1 VPS yeter</small>
        </A>
        <A href="/" class={isActive('/')}>
          <span>📰</span> Public
        </A>
        <A href="/feed" class={isActive('/feed')}>
          <span>🏠</span> Feed
        </A>
        <A href="/search" class={isActive('/search')}>
          <span>🔎</span> Ara
        </A>
        <A href="/notifications" class={isActive('/notifications')}>
          <span>🔔</span> Bildirimler
          <Show when={(unread() ?? 0) > 0}>
            <span class="tiny" style="color: var(--accent); margin-left: auto;">
              {unread()}
            </span>
          </Show>
        </A>
        <Show
          when={me()}
          fallback={
            <A href="/login" class={isActive('/login')}>
              <span>🔑</span> Giriş
            </A>
          }
        >
          {(u) => (
            <>
              <A href={`/u/${u().username}`} class={isActive(`/u/${u().username}`)}>
                <span>👤</span> Profilim
              </A>
              <A href="/bookmarks" class={isActive('/bookmarks')}>
                <span>🔖</span> Kayıtlılar
              </A>
              <A href="/settings" class={isActive('/settings')}>
                <span>⚙️</span> Ayarlar
              </A>
              <div class="me">
                @{u().username}
                <Show when={u().pending_2fa}>
                  {' '}
                  <span class="tiny" style="color: var(--warn);">
                    (2FA bekleniyor)
                  </span>
                </Show>
                <br />
                <button class="ghost tiny" onClick={() => logout()}>
                  Çıkış
                </button>
              </div>
            </>
          )}
        </Show>
      </nav>
      <main class="main">{props.children}</main>
      <ToastStack />
    </div>
  );
}
