import { createResource, For, Show, onMount, onCleanup } from 'solid-js';
import { A } from '@solidjs/router';
import { api } from '../api';
import { me } from '../auth';
import { relTime } from '../util';

interface ThreadSummary {
  id: string;
  other_id: string;
  other_username: string;
  other_display_name: string;
  last_body: string | null;
  last_sender_id: string | null;
  last_message_at: string;
  unread_count: number;
}

export default function DMs() {
  const [list, { refetch }] = createResource<ThreadSummary[] | null>(async () => {
    if (!me()) return null;
    return api.get<ThreadSummary[]>('/dm/threads');
  });

  // 19 May 2026 — Real-time: yeni DM event geldiginde listeyi refetch et
  // (eski: sadece toast goruluyor, liste yenilemek icin sayfa refresh gerekti).
  const onNotif = (ev: Event) => {
    const detail = (ev as CustomEvent).detail as { kind?: string } | undefined;
    if (detail?.kind === 'dm') refetch();
  };
  onMount(() => window.addEventListener('burncpu:notification', onNotif));
  onCleanup(() => window.removeEventListener('burncpu:notification', onNotif));

  return (
    <>
      <h2 class="page-title">Mesajlar</h2>
      <Show when={me()} fallback={<p class="muted">Önce <A href="/login">giriş yap</A>.</p>}>
        <p class="tiny muted">
          DM atabilmek için iki tarafın da birbirini takip etmesi gerekiyor.
        </p>
        <Show when={list()} fallback={<p class="muted">Yükleniyor…</p>}>
          {(rows) => (
            <For each={rows()} fallback={<p class="muted">Henüz mesajın yok.</p>}>
              {(t) => (
                <A
                  href={`/dm/${t.other_username}`}
                  style="text-decoration: none; color: inherit; display: block; padding: 12px 0; border-bottom: 1px solid var(--border);"
                >
                  <div class="flex" style="align-items: baseline;">
                    <strong>{t.other_display_name}</strong>
                    <span class="muted tiny">@{t.other_username}</span>
                    <span class="time muted" style="margin-left: auto; font-family: var(--mono); font-size: 11px;">
                      {relTime(t.last_message_at)}
                    </span>
                  </div>
                  <div
                    style={`color: ${t.unread_count > 0 ? 'var(--fg)' : 'var(--fg-2)'}; font-size: 13px; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;`}
                  >
                    {t.last_body ?? '—'}
                  </div>
                  <Show when={t.unread_count > 0}>
                    <span
                      class="tiny"
                      style="color: var(--accent); font-weight: 600;"
                    >
                      {t.unread_count} yeni
                    </span>
                  </Show>
                </A>
              )}
            </For>
          )}
        </Show>
      </Show>
    </>
  );
}
