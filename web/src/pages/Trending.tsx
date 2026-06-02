import { createResource, createSignal, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api, type PostView } from '../api';
import Post from '../components/Post';
import { PostSkeletonList } from '../components/Skeleton';
import { t } from '../i18n';

interface TagCount { tag: string; count: number }
interface TrendingPost {
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
}

const WINDOWS = [
  { value: '1h', labelKey: 'window.1h' },
  { value: '24h', labelKey: 'window.24h' },
  { value: '7d', labelKey: 'window.7d' },
];

export default function Trending() {
  // NB: don't name this `window` — it would shadow the global.
  const [win, setWin] = createSignal('24h');
  const [tags] = createResource<TagCount[], string>(win, (w) =>
    api.get<TagCount[]>(`/trending/hashtags?window=${w}&limit=20`),
  );
  const [posts] = createResource<TrendingPost[], string>(win, (w) =>
    api.get<TrendingPost[]>(`/trending/posts?window=${w}&limit=15`),
  );

  const toView = (p: TrendingPost): PostView => ({
    id: p.id,
    author: {
      id: p.author_id,
      username: p.author_username,
      display_name: p.author_display_name,
      avatar_url: p.author_avatar_url,
    },
    body: p.body,
    body_html: p.body_html,
    visibility: 'public',
    reply_to_id: null,
    reactions_count: p.reactions_count,
    replies_count: p.replies_count,
    created_at: p.created_at,
  });

  return (
    <div>
      <div class="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <h1 class="text-[24px] md:text-[28px] font-bold tracking-tight text-on-background">{t('trending.title')}</h1>
        <div class="flex gap-1 p-1 bg-surface-container-low border border-outline-variant rounded-xl">
          <For each={WINDOWS}>
            {(w) => (
              <button
                onClick={() => setWin(w.value)}
                class={`px-3 py-1.5 rounded-lg font-mono text-[12px] font-bold transition-colors ${
                  win() === w.value
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                }`}
              >
                {t(w.labelKey)}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* ── Trending hashtags ── */}
      <section class="mb-8">
        <h2 class="font-mono text-[12px] uppercase tracking-widest text-on-surface-variant mb-3">{t('trending.hashtags')}</h2>
        <Show
          when={tags()}
          fallback={
            <div class="flex flex-wrap gap-2">
              <For each={Array.from({ length: 8 })}>{() => <div class="skeleton rounded-full h-7 w-24" />}</For>
            </div>
          }
        >
          {(tg) => (
            <div class="flex flex-wrap gap-2">
              <For each={tg()} fallback={<p class="text-on-surface-variant font-mono text-[13px]">{t('trending.no_hashtags')}</p>}>
                {(x) => (
                  <A
                    href={`/hashtag/${x.tag}`}
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container border border-outline-variant text-primary font-mono text-[13px] hover:border-primary/50 hover:bg-surface-container-high transition-colors"
                  >
                    #{x.tag}
                    <span class="text-on-surface-variant/70 text-[11px]">{x.count}</span>
                  </A>
                )}
              </For>
            </div>
          )}
        </Show>
      </section>

      {/* ── Trending posts ── */}
      <section>
        <h2 class="font-mono text-[12px] uppercase tracking-widest text-on-surface-variant mb-3">{t('trending.posts')}</h2>
        <Show when={posts()} fallback={<PostSkeletonList count={4} />}>
          {(ps) => (
            <Show
              when={ps().length > 0}
              fallback={<p class="text-on-surface-variant font-mono text-[13px]">{t('trending.no_posts')}</p>}
            >
              <div class="space-y-6">
                <For each={ps()}>{(p) => <Post post={toView(p)} />}</For>
              </div>
            </Show>
          )}
        </Show>
      </section>
    </div>
  );
}
