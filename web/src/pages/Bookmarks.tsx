import { createResource, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api, type PostView } from '../api';
import Post from '../components/Post';
import { PostSkeletonList } from '../components/Skeleton';
import { me } from '../auth';
import { t } from '../i18n';

interface Bookmarked {
  id: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  author_avatar_url: string | null;
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

  // Reuse the full <Post> card so saved posts get avatars, reactions, link
  // previews and the menu — same as the timeline.
  const toView = (b: Bookmarked): PostView => ({
    id: b.id,
    author: {
      id: b.author_id,
      username: b.author_username,
      display_name: b.author_display_name,
      avatar_url: b.author_avatar_url,
    },
    body: b.body,
    body_html: b.body_html,
    visibility: 'public',
    reply_to_id: null,
    reactions_count: b.reactions_count,
    replies_count: b.replies_count,
    created_at: b.created_at,
    viewer_bookmarked: true,
  });

  return (
    <div>
      <h1 class="text-[24px] md:text-[28px] font-bold tracking-tight text-on-background mb-5">{t('nav.bookmarks')}</h1>
      <Show
        when={me()}
        fallback={
          <p class="text-on-surface-variant">
            {t('auth.login_prefix')} <A href="/login" class="text-primary hover:underline">{t('auth.login_link')}</A>.
          </p>
        }
      >
        <Show when={list()} fallback={<PostSkeletonList count={4} />}>
          {(rows) => (
            <Show
              when={rows().length > 0}
              fallback={
                <div class="p-10 border border-dashed border-outline-variant rounded-2xl text-center">
                  <div class="text-[32px] mb-2">🔖</div>
                  <p class="text-on-surface-variant font-mono text-[14px]">{t('bookmarks.empty')}</p>
                </div>
              }
            >
              <div class="space-y-6">
                <For each={rows()}>{(b) => <Post post={toView(b)} onChange={refetch} />}</For>
              </div>
            </Show>
          )}
        </Show>
      </Show>
    </div>
  );
}
