import { createResource, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api } from '../api';
import { me } from '../auth';
import { relTime } from '../util';

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
      <h2 class="page-title">Kayıtlılar</h2>
      <Show when={me()} fallback={<p class="muted">Önce <A href="/login">giriş yap</A>.</p>}>
        <Show when={list()} fallback={<p class="muted">Yükleniyor…</p>}>
          {(rows) => (
            <For each={rows()} fallback={<p class="muted">Henüz post kaydetmemişsin.</p>}>
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
                    {p.reactions_count} tepki · {p.replies_count} reply ·
                    <button class="ghost tiny" onClick={() => remove(p.id)} style="margin-left: 6px;">
                      kayıttan çıkar
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
