import { createResource, createSignal, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api } from '../api';
import { relTime } from '../util';

interface TagCount { tag: string; count: number }
interface TrendingPost {
  id: string;
  author_username: string;
  author_display_name: string;
  body: string;
  body_html: string;
  reactions_count: number;
  replies_count: number;
  created_at: string;
}

const WINDOWS: { value: string; label: string }[] = [
  { value: '1h', label: '1 saat' },
  { value: '24h', label: '24 saat' },
  { value: '7d', label: '7 gün' },
];

export default function Trending() {
  const [window, setWindow] = createSignal('24h');
  const [tags] = createResource<TagCount[], string>(
    window,
    (w: string) => api.get<TagCount[]>(`/trending/hashtags?window=${w}&limit=20`),
  );
  const [posts] = createResource<TrendingPost[], string>(
    window,
    (w: string) => api.get<TrendingPost[]>(`/trending/posts?window=${w}&limit=15`),
  );

  return (
    <>
      <h2 class="page-title">
        Trend
        <small>
          <For each={WINDOWS}>
            {(w) => (
              <button
                onClick={() => setWindow(w.value)}
                style={`background: transparent; border: none; padding: 0 6px; color: ${window() === w.value ? 'var(--accent)' : 'var(--fg-3)'}; cursor: pointer; font: inherit;`}
              >
                {w.label}
              </button>
            )}
          </For>
        </small>
      </h2>
      <h3 style="margin-top: 18px;">Hashtag'ler</h3>
      <Show when={tags()} fallback={<p class="muted">…</p>}>
        {(t) => (
          <div class="flex" style="flex-wrap: wrap; gap: 6px;">
            <For each={t() as TagCount[]} fallback={<p class="muted">Bu pencerede hashtag yok.</p>}>
              {(x) => (
                <A
                  href={`/hashtag/${x.tag}`}
                  style="padding: 4px 10px; background: var(--bg-3); border-radius: 999px; font-size: 13px; color: var(--accent);"
                >
                  #{x.tag} <span class="muted">{x.count}</span>
                </A>
              )}
            </For>
          </div>
        )}
      </Show>

      <h3 style="margin-top: 22px;">Postlar</h3>
      <Show when={posts()} fallback={<p class="muted">…</p>}>
        {(ps) => (
          <For each={ps() as TrendingPost[]} fallback={<p class="muted">Bu pencerede post yok.</p>}>
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
                  {p.reactions_count} tepki · {p.replies_count} reply
                </div>
              </article>
            )}
          </For>
        )}
      </Show>
    </>
  );
}
