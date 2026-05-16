import { createResource, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api, type Notification } from '../api';
import { me, refetchUnread } from '../auth';
import { relTime } from '../util';

interface Listing {
  notifications: Notification[];
  next_before: string | null;
}

const icon = (k: Notification['kind']) =>
  k === 'reaction' ? '★' : k === 'reply' ? '↳' : k === 'follow' ? '+' : k === 'mention' ? '@' : '!';

function text(n: Notification) {
  const who = n.actor_username ?? 'biri';
  switch (n.kind) {
    case 'reaction': {
      const emoji =
        n.metadata && typeof n.metadata['emoji'] === 'string'
          ? (n.metadata['emoji'] as string)
          : '';
      return (
        <>
          <strong>@{who}</strong> postuna {emoji} tepkisi verdi
        </>
      );
    }
    case 'reply':
      return (
        <>
          <strong>@{who}</strong> postuna yanıt verdi
        </>
      );
    case 'follow':
      return (
        <>
          <strong>@{who}</strong> seni takip etmeye başladı
        </>
      );
    case 'mention':
      return (
        <>
          <strong>@{who}</strong> seni bahsetti
        </>
      );
    case 'mod_action':
      return <>Bir yönetim eylemi içeriğinde uygulandı</>;
  }
}

const linkFor = (n: Notification): string => {
  if (n.target_kind === 'post') return `/posts/${n.target_id}`;
  if (n.target_kind === 'user' && n.actor_username) return `/@${n.actor_username}`;
  return '/';
};

export default function NotificationsPage() {
  const [data, { mutate }] = createResource<Listing | null>(async () => {
    if (!me()) return null;
    return api.get<Listing>('/notifications?limit=50');
  });

  const markAll = async () => {
    await api.patch('/notifications/read');
    const cur = data();
    if (cur)
      mutate({
        ...cur,
        notifications: cur.notifications.map((n) => ({
          ...n,
          read_at: n.read_at ?? new Date().toISOString(),
        })),
      });
    refetchUnread();
  };

  return (
    <>
      <h2 class="page-title">
        Bildirimler
        <Show when={me()}>
          <button class="ghost tiny" onClick={markAll}>
            Hepsini okundu işaretle
          </button>
        </Show>
      </h2>
      <Show
        when={me()}
        fallback={
          <p class="muted">
            <A href="/login">Giriş yap</A>.
          </p>
        }
      >
        <Show when={data()} fallback={<p class="muted">Yükleniyor…</p>}>
          {(d) => (
            <For each={d().notifications} fallback={<p class="muted">Bildirim yok.</p>}>
              {(n) => (
                <A
                  href={linkFor(n)}
                  style="text-decoration: none; color: inherit; display: block;"
                >
                  <div class={`notif ${n.read_at ? '' : 'unread'}`}>
                    <span class="kind-icon">{icon(n.kind)}</span>
                    <span>{text(n)}</span>
                    <span class="time">{relTime(n.created_at)}</span>
                  </div>
                </A>
              )}
            </For>
          )}
        </Show>
      </Show>
    </>
  );
}
