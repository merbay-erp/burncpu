import { createSignal, For, Show } from 'solid-js';
import { api, type Timeline, type PostView } from '../api';
import Post from '../components/Post';
import Compose from '../components/Compose';
import InfiniteList from '../components/InfiniteList';
import { me } from '../auth';
import { t } from '../i18n';

export default function Home() {
  const [posts, setPosts] = createSignal<PostView[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [cursorId, setCursorId] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [initialized, setInitialized] = createSignal(false);

  const loadMore = async () => {
    if (loading() || done()) return;
    setLoading(true);
    try {
      const qs = cursor()
        ? `?limit=30&before=${encodeURIComponent(cursor()!)}${cursorId() ? `&before_id=${encodeURIComponent(cursorId()!)}` : ''}`
        : '?limit=30';
      const page = await api.get<Timeline>(`/posts${qs}`);
      setPosts((cur) => [...cur, ...page.posts]);
      if (page.next_before && page.posts.length > 0) {
        setCursor(page.next_before);
        setCursorId(page.next_before_id ?? null);
      } else setDone(true);
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  };

  const prepend = (p: PostView) => setPosts((cur) => [p, ...cur]);
  const reload = async () => {
    setPosts([]); setCursor(null); setCursorId(null); setDone(false); setInitialized(false);
    await loadMore();
  };

  return (
    <>
      <header class="mb-8 border-b border-outline-variant pb-4">
        <h1 class="font-headline-lg text-[28px] md:text-[32px] font-semibold tracking-tight text-on-background">
          {t('home.title')}
        </h1>
        <p class="text-on-surface-variant font-mono text-[14px] mt-1">
          {t('home.subtitle')}
        </p>
      </header>

      <Show when={me()}>
        <Compose onPosted={prepend} />
      </Show>

      <InfiniteList onLoadMore={loadMore} loading={loading()} done={done()}>
        <div class="space-y-6">
          <For
            each={posts()}
            fallback={
              initialized() ? (
                <div class="p-6 border border-dashed border-outline-variant rounded-xl text-on-surface-variant font-mono text-[14px] text-center">
                  {t('home.empty')}
                </div>
              ) : null
            }
          >
            {(p) => <Post post={p} onChange={reload} />}
          </For>
        </div>
      </InfiniteList>
    </>
  );
}
