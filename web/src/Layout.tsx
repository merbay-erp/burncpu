import type { JSX } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { Show, onMount } from 'solid-js';
import { me, unread, refetchUnread, probeSession, logout } from './auth';

export default function Layout(props: { children?: JSX.Element }) {
  const loc = useLocation();
  const isActive = (p: string) => (loc.pathname === p ? 'active' : '');

  onMount(async () => {
    // Always probe — cookie may be present without cached identity (e.g.
    // after clicking a magic-link email which redirects back to /).
    const ok = await probeSession();
    if (ok) refetchUnread();
  });

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
    </div>
  );
}
