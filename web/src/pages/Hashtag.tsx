import { createResource, createSignal, For, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { api, type SearchResponse, type SearchHit, type PostView } from '../api';
import Post from '../components/Post';
import { PostSkeletonList } from '../components/Skeleton';
import { linkifyTags } from '../util';
import { me } from '../auth';
import { t } from '../i18n';

export default function Hashtag() {
  const params = useParams<{ tag: string }>();
  const [results] = createResource<SearchResponse, string>(
    () => params.tag,
    (tag: string) => api.get<SearchResponse>(`/hashtags/${encodeURIComponent(tag)}`),
  );

  // Follow state for "follow a topic, not a person": followed tags' public
  // posts surface in the personal feed (/feed). Optimistic toggle.
  const [followState] = createResource<{ following: boolean }, string>(
    () => params.tag,
    (tag: string) => api.get<{ following: boolean }>(`/hashtags/${encodeURIComponent(tag)}/follow`),
  );
  const [override, setOverride] = createSignal<boolean | null>(null);
  const [busy, setBusy] = createSignal(false);
  const following = () => override() ?? followState()?.following ?? false;
  const toggleFollow = async () => {
    if (busy()) return;
    setBusy(true);
    const want = !following();
    setOverride(want);
    try {
      const path = `/hashtags/${encodeURIComponent(params.tag)}/follow`;
      if (want) await api.post(path);
      else await api.del(path);
    } catch {
      setOverride(!want);
    } finally {
      setBusy(false);
    }
  };

  // Search hits are lean (raw body, no body_html) — synthesize a PostView and
  // linkify the body client-side so tagged posts render as full <Post> cards
  // (avatars, link previews, URL-strip, reactions) like the timeline.
  const toView = (h: SearchHit): PostView => ({
    id: h.id,
    author: {
      id: h.author_id,
      username: h.author_username,
      display_name: h.author_display_name || h.author_username,
      avatar_url: h.author_avatar_url ?? null,
    },
    body: h.body,
    body_html: linkifyTags(h.body),
    visibility: 'public',
    reply_to_id: null,
    reactions_count: h.reactions_count ?? 0,
    replies_count: h.replies_count ?? 0,
    created_at: new Date(h.created_at * 1000).toISOString(),
  });

  return (
    <div>
      <div class="flex items-start justify-between gap-3 mb-1">
        <h1 class="text-[24px] md:text-[28px] font-bold tracking-tight text-primary">#{params.tag}</h1>
        <Show when={me()}>
          <button
            onClick={toggleFollow}
            disabled={busy()}
            class={
              following()
                ? 'shrink-0 px-4 py-1.5 rounded-lg border border-outline-variant text-on-background font-mono text-[13px] hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-50'
                : 'shrink-0 px-5 py-1.5 rounded-lg bg-primary text-on-primary font-bold font-mono text-[13px] hover:opacity-90 active:scale-95 transition-all disabled:opacity-50'
            }
          >
            {following() ? t('hashtag.unfollow') : t('hashtag.follow')}
          </button>
        </Show>
      </div>
      <p class="text-on-surface-variant font-mono text-[12px] mb-5">
        {results()?.estimatedTotalHits ?? '…'} {t('search.results')}
      </p>

      <Show when={results()} fallback={<PostSkeletonList count={4} />}>
        {(r) => (
          <Show
            when={r().hits.length > 0}
            fallback={
              <div class="p-10 border border-dashed border-outline-variant rounded-2xl text-center">
                <div class="text-[28px] mb-2">🔍</div>
                <p class="text-on-surface-variant font-mono text-[14px]">{t('search.no_results')}</p>
              </div>
            }
          >
            <div class="space-y-6">
              <For each={r().hits}>{(h) => <Post post={toView(h)} />}</For>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}
