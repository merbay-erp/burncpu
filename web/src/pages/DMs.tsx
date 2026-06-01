import { createResource, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { api } from '../api';
import { me } from '../auth';
import { relTime } from '../util';
import { t } from '../i18n';

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

interface UserBrief {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export default function DMs() {
  const navigate = useNavigate();
  const [list, { refetch }] = createResource<ThreadSummary[] | null>(async () => {
    if (!me()) return null;
    return api.get<ThreadSummary[]>('/dm/threads');
  });

  // New-message composer: pick a user via typeahead → open their thread.
  const [composing, setComposing] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<UserBrief[]>([]);
  let lookupTimer: ReturnType<typeof setTimeout> | undefined;

  const onQuery = (v: string) => {
    setQuery(v);
    if (lookupTimer) clearTimeout(lookupTimer);
    const q = v.trim();
    if (q.length < 1) { setResults([]); return; }
    lookupTimer = setTimeout(async () => {
      try {
        const r = await api.get<UserBrief[]>(`/users/lookup?prefix=${encodeURIComponent(q)}`);
        setResults(r.filter((u) => u.username !== me()?.username));
      } catch { setResults([]); }
    }, 150);
  };

  const openCompose = () => {
    setComposing((v) => !v);
    setQuery('');
    setResults([]);
  };

  // 19 May 2026 — Real-time: yeni DM event geldiginde listeyi refetch et.
  const onNotif = (ev: Event) => {
    const detail = (ev as CustomEvent).detail as { kind?: string } | undefined;
    if (detail?.kind === 'dm') refetch();
  };
  onMount(() => window.addEventListener('burncpu:notification', onNotif));
  onCleanup(() => {
    window.removeEventListener('burncpu:notification', onNotif);
    if (lookupTimer) clearTimeout(lookupTimer);
  });

  return (
    <div class="legacy">
      <div class="flex" style="align-items: center; justify-content: space-between;">
        <h2 class="page-title" style="margin: 0;">{t('dm.title')}</h2>
        <Show when={me()}>
          <button class="primary" onClick={openCompose}>
            {composing() ? t('common.cancel') : `+ ${t('dm.new')}`}
          </button>
        </Show>
      </div>

      <Show when={me()} fallback={<p class="muted">Önce <A href="/login">{t('nav.login')}</A>.</p>}>
        <Show when={composing()}>
          <div style="margin: 14px 0; position: relative;">
            <input
              type="text"
              placeholder={t('dm.search_user')}
              value={query()}
              onInput={(e) => onQuery(e.currentTarget.value)}
              autofocus
            />
            <Show when={results().length > 0}>
              <div style="margin-top: 6px; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--bg-2);">
                <For each={results()}>
                  {(u) => (
                    <button
                      onClick={() => navigate(`/dm/${u.username}`)}
                      style="display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: none; border-radius: 0; background: transparent; text-align: left;"
                    >
                      <span style="width: 32px; height: 32px; border-radius: 8px; background: var(--bg-3); display: inline-flex; align-items: center; justify-content: center; font-size: 16px; overflow: hidden;">
                        <Show when={u.avatar_url} fallback={<>🐢</>}>
                          <img src={u.avatar_url!} alt="" style="width: 100%; height: 100%; object-fit: cover;" />
                        </Show>
                      </span>
                      <span style="min-width: 0;">
                        <strong style="display: block;">{u.display_name}</strong>
                        <span class="muted tiny">@{u.username}</span>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={query().trim().length > 0 && results().length === 0}>
              <p class="muted tiny" style="margin-top: 6px;">{t('dm.no_user')}</p>
            </Show>
          </div>
        </Show>

        <p class="tiny muted">{t('dm.mutual_required')}</p>
        <Show when={list()} fallback={<p class="muted">{t('loading')}</p>}>
          {(rows) => (
            <For each={rows()} fallback={<p class="muted">{t('dm.empty')}</p>}>
              {(thread) => (
                <A
                  href={`/dm/${thread.other_username}`}
                  style="text-decoration: none; color: inherit; display: block; padding: 12px 0; border-bottom: 1px solid var(--border);"
                >
                  <div class="flex" style="align-items: baseline;">
                    <strong>{thread.other_display_name}</strong>
                    <span class="muted tiny">@{thread.other_username}</span>
                    <span class="time muted" style="margin-left: auto; font-family: var(--mono); font-size: 11px;">
                      {relTime(thread.last_message_at)}
                    </span>
                  </div>
                  <div
                    style={`color: ${thread.unread_count > 0 ? 'var(--fg)' : 'var(--fg-2)'}; font-size: 13px; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;`}
                  >
                    {thread.last_body ?? '—'}
                  </div>
                  <Show when={thread.unread_count > 0}>
                    <span class="tiny" style="color: var(--accent); font-weight: 600;">
                      {thread.unread_count} {t('dm.new_count')}
                    </span>
                  </Show>
                </A>
              )}
            </For>
          )}
        </Show>
      </Show>
    </div>
  );
}
