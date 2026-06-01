import { createResource, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api } from '../api';
import { me } from '../auth';
import { relTime } from '../util';
import { t } from '../i18n';

interface TrashedPost {
  id: string;
  body: string;
  deleted_at: string;
  created_at: string;
}

export default function Trash() {
  const [list, { refetch }] = createResource<TrashedPost[] | null>(async () => {
    if (!me()) return null;
    return api.get<TrashedPost[]>('/users/me/trash');
  });

  const restore = async (id: string) => {
    await api.post(`/posts/${id}/restore`);
    refetch();
  };

  const daysLeft = (deleted_at: string): number => {
    const d = Date.parse(deleted_at);
    const left = 30 - Math.floor((Date.now() - d) / 86400000);
    return Math.max(0, left);
  };

  return (
    <>
      <h2 class="page-title">
        {t('nav.trash')} <small>{t('trash.retention_note')}</small>
      </h2>
      <Show when={me()} fallback={<p class="muted">{t('auth.login_prefix')} <A href="/login">{t('auth.login_link')}</A>.</p>}>
        <Show when={list()} fallback={<p class="muted">{t('common.loading')}</p>}>
          {(rows) => (
            <For each={rows()} fallback={<p class="muted">{t('trash.empty')}</p>}>
              {(p) => (
                <article class="post">
                  <div class="post-head">
                    <span class="time" style="color: var(--fg-3);">
                      {t('trash.deleted_prefix')} {relTime(p.deleted_at)}
                    </span>
                    <span class="tiny" style={`margin-left: auto; color: ${daysLeft(p.deleted_at) <= 3 ? 'var(--bad)' : 'var(--warn)'};`}>
                      {daysLeft(p.deleted_at)} {t('trash.days_left')}
                    </span>
                  </div>
                  <div
                    class="post-body muted"
                    style="white-space: pre-wrap;"
                  >
                    {p.body}
                  </div>
                  <div class="post-foot tiny">
                    <button class="primary tiny" onClick={() => restore(p.id)}>{t('trash.restore')}</button>
                  </div>
                </article>
              )}
            </For>
          )}
        </Show>
      </Show>
    </>
  );
}
