import { createSignal, createResource, For, Show } from 'solid-js';
import { A, useSearchParams } from '@solidjs/router';
import { api, type SearchResponse, type SearchHit } from '../api';
import { relTime, linkifyTags } from '../util';
import Avatar from '../components/Avatar';
import { t } from '../i18n';

export default function Search() {
  // Read the initial query from the URL so the top-nav search (which routes to
  // /search?q=…) and deep links land on results, not an empty box.
  const [searchParams, setSearchParams] = useSearchParams<{ q?: string }>();
  const initialQ = (searchParams.q ?? '').trim();
  const [q, setQ] = createSignal(initialQ);
  const [trigger, setTrigger] = createSignal(initialQ);
  const [results] = createResource<SearchResponse, string>(
    () => trigger() || (null as unknown as string),
    (qs: string) => api.get<SearchResponse>(`/search?q=${encodeURIComponent(qs)}`),
  );

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const onInput = (v: string) => {
    setQ(v);
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      const term = v.trim();
      setTrigger(term);
      setSearchParams({ q: term || undefined });
    }, 300);
  };
  const snippet = (hit: SearchHit) =>
    (hit._formatted?.body ?? hit.body).replaceAll('<mark>', '').replaceAll('</mark>', '');

  return (
    <div>
      <header class="mb-5">
        <h1 class="text-[24px] md:text-[28px] font-bold tracking-tight text-on-background">{t('search.title')}</h1>
      </header>

      <div class="relative">
        <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" style="font-size:20px;">search</span>
        <input
          ref={(el) => setTimeout(() => el?.focus(), 0)}
          type="search"
          placeholder={t('search.placeholder')}
          value={q()}
          onInput={(e) => onInput(e.currentTarget.value)}
          class="w-full bg-surface-container border border-outline-variant rounded-full pl-11 pr-4 py-2.5 font-mono text-[14px] text-on-background placeholder:text-on-surface-variant/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
        />
      </div>

      <Show when={results()}>
        {(r) => (
          <>
            <div class="text-on-surface-variant font-mono text-[12px] mt-3 px-1">
              {r().estimatedTotalHits ?? r().hits.length} {t('search.results')} · {r().processingTimeMs ?? 0}ms
            </div>
            <div class="mt-4 space-y-4">
              <For
                each={r().hits}
                fallback={
                  <div class="p-6 border border-dashed border-outline-variant rounded-2xl text-on-surface-variant font-mono text-center text-[14px]">
                    {t('search.no_results')}
                  </div>
                }
              >
                {(h: SearchHit) => (
                  <article class="p-5 bg-surface-container-low border border-outline-variant rounded-2xl hover:border-primary/40 hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)] transition-all">
                    <div class="flex items-center gap-2 mb-2">
                      <Avatar url={h.author_avatar_url} name={h.author_username} size={28} class="rounded-lg ring-1 ring-outline-variant/60" />
                      <A href={`/u/${h.author_username}`} class="font-bold text-on-background text-[13px] truncate hover:text-primary transition-colors">
                        @{h.author_username}
                      </A>
                      <A href={`/posts/${h.id}`} class="text-on-surface-variant font-mono text-[12px] ml-auto shrink-0 hover:text-primary transition-colors">
                        {relTime(new Date(h.created_at * 1000).toISOString())}
                      </A>
                    </div>
                    <div class="post-body text-on-surface text-[14px] leading-relaxed line-clamp-4" innerHTML={linkifyTags(snippet(h))} />
                  </article>
                )}
              </For>
            </div>
          </>
        )}
      </Show>

      <Show when={!trigger() && !results()}>
        <p class="text-on-surface-variant text-[13px] mt-5 px-1">
          {t('search.hint_prefix')} <code>federation</code>, <code>rust</code>, <code>1 vps</code> {t('search.hint_suffix')}
        </p>
      </Show>
    </div>
  );
}
