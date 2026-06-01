import { createResource, For, Show } from 'solid-js';
import { useParams, A } from '@solidjs/router';
import { api, type SearchResponse, type SearchHit } from '../api';
import { relTime } from '../util';
import { t } from '../i18n';

export default function Hashtag() {
  const params = useParams<{ tag: string }>();
  const [results] = createResource<SearchResponse, string>(
    () => params.tag,
    (t: string) => api.get<SearchResponse>(`/hashtags/${encodeURIComponent(t)}`),
  );

  return (
    <>
      <h2 class="page-title">
        #{params.tag} <small>{results()?.estimatedTotalHits ?? '…'} {t('search.results')}</small>
      </h2>
      <Show when={results()} fallback={<div class="muted">{t('common.loading')}</div>}>
        {(r) => (
          <For each={r().hits} fallback={<div class="muted">{t('search.no_results')}</div>}>
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
                <div class="post-body">{h.body}</div>
              </article>
            )}
          </For>
        )}
      </Show>
    </>
  );
}
