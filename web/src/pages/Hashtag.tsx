import { createResource, For, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { api, type SearchResponse, type SearchHit, type PostView } from '../api';
import Post from '../components/Post';
import { PostSkeletonList } from '../components/Skeleton';
import { linkifyTags } from '../util';
import { t } from '../i18n';

export default function Hashtag() {
  const params = useParams<{ tag: string }>();
  const [results] = createResource<SearchResponse, string>(
    () => params.tag,
    (tag: string) => api.get<SearchResponse>(`/hashtags/${encodeURIComponent(tag)}`),
  );

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
      <h1 class="text-[24px] md:text-[28px] font-bold tracking-tight text-primary mb-1">#{params.tag}</h1>
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
