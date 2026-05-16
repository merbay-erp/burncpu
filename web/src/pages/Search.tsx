import { createSignal, createResource, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api, type SearchResponse, type SearchHit } from '../api';
import { relTime } from '../util';

export default function Search() {
  const [q, setQ] = createSignal('');
  const [trigger, setTrigger] = createSignal('');
  const [results] = createResource<SearchResponse, string>(
    () => trigger() || null as unknown as string,
    (qs: string) => api.get<SearchResponse>(`/search?q=${encodeURIComponent(qs)}`),
  );

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const onInput = (v: string) => {
    setQ(v);
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => setTrigger(v.trim()), 300);
  };

  return (
    <>
      <h2 class="page-title">Ara</h2>
      <input
        ref={(el) => setTimeout(() => el?.focus(), 0)}
        type="search"
        placeholder="Ne arıyorsun? (kelime veya #hashtag)"
        value={q()}
        onInput={(e) => onInput(e.currentTarget.value)}
      />
      <Show when={results()}>
        {(r) => (
          <>
            <div class="tiny muted" style="margin-top: 6px;">
              {r().estimatedTotalHits ?? r().hits.length} sonuç · {r().processingTimeMs ?? 0}ms
            </div>
            <div style="margin-top: 14px;">
              <For each={r().hits} fallback={<div class="muted">Sonuç yok.</div>}>
                {(h: SearchHit) => (
                  <article class="post">
                    <div class="post-head">
                      <A href={`/u/${h.author_username}`} class="handle" style="color: var(--fg-2);">
                        @{h.author_username}
                      </A>
                      <A
                        href={`/posts/${h.id}`}
                        class="time"
                        style="margin-left: auto; color: var(--fg-3);"
                      >
                        {relTime(new Date(h.created_at * 1000).toISOString())}
                      </A>
                    </div>
                    <div class="post-body" innerHTML={h._formatted?.body ?? h.body} />
                  </article>
                )}
              </For>
            </div>
          </>
        )}
      </Show>
      <Show when={!trigger() && !results()}>
        <p class="muted tiny" style="margin-top: 14px;">
          İpucu: <code>federation</code>, <code>rust</code>, <code>1 vps</code> dene.
        </p>
      </Show>
    </>
  );
}
