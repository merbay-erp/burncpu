import { createResource, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api } from '../api';
import { me } from '../auth';
import { relTime } from '../util';
import { t } from '../i18n';

interface Bookmarked {
  id: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  body: string;
  body_html: string;
  reactions_count: number;
  replies_count: number;
  created_at: string;
  bookmarked_at: string;
}

export default function Bookmarks() {
  const [list, { refetch }] = createResource<Bookmarked[] | null>(async () => {
    if (!me()) return null;
    return api.get<Bookmarked[]>('/bookmarks');
  });

  const remove = async (id: string) => {
    await api.del(`/bookmarks/${id}`);
    refetch();
  };

  return (
    <>
      <h2 class="page-title">{t('nav.bookmarks')}</h2>
      <Show when={me()} fallback={<p class="muted">{t('auth.login_prefix')} <A href="/login">{t('auth.login_link')}</A>.</p>}>
        <Show when={list()} fallback={<p class="muted">{t('common.loading')}</p>}>
          {(rows) => (
            <For each={rows()} fallback={<p class="muted">{t('bookmarks.empty')}</p>}>
              {(p) => (
                <article class="post">
                  <div class="post-head">
                    <A href={`/u/${p.author_username}`} class="name" style="color: inherit;">
                      {p.author_display_name}
                    </A>
                    <A href={`/u/${p.author_username}`} class="handle" style="color: var(--fg-2);">
                      @{p.author_username}
                    </A>
                    <A href={`/posts/${p.id}`} class="time" style="color: var(--fg-3);">
                      {relTime(p.created_at)}
                    </A>
                  </div>
                  <div class="post-body" innerHTML={p.body_html} />
                  <div class="post-foot tiny muted">
                    {p.reactions_count} {t('post.reactions')} · {p.replies_count} {t('post.replies')} ·
                    <button class="ghost tiny" onClick={() => remove(p.id)} style="margin-left: 6px;">
                      {t('bookmarks.remove')}
                    </button>
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
