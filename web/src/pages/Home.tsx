import { createSignal, For, Show } from 'solid-js';
import { api, type Timeline, type PostView } from '../api';
import Post from '../components/Post';
import Compose from '../components/Compose';
import InfiniteList from '../components/InfiniteList';
import { me } from '../auth';

export default function Home() {
  const [posts, setPosts] = createSignal<PostView[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [initialized, setInitialized] = createSignal(false);

  const loadMore = async () => {
    if (loading() || done()) return;
    setLoading(true);
    try {
      const qs = cursor() ? `?limit=30&before=${encodeURIComponent(cursor()!)}` : '?limit=30';
      const page = await api.get<Timeline>(`/posts${qs}`);
      setPosts((cur) => [...cur, ...page.posts]);
      if (page.next_before && page.posts.length > 0) {
        setCursor(page.next_before);
      } else {
        setDone(true);
      }
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  };

  const prepend = (p: PostView) => setPosts((cur) => [p, ...cur]);
  const reload = async () => {
    setPosts([]);
    setCursor(null);
    setDone(false);
    setInitialized(false);
    await loadMore();
  };

  return (
    <>
      <h2 class="page-title">
        Public timeline <small>herkesin paylaştığı</small>
      </h2>
      <Show when={me()}>
        <Compose onPosted={prepend} />
      </Show>
      <InfiniteList onLoadMore={loadMore} loading={loading()} done={done()}>
        <For
          each={posts()}
          fallback={
            initialized() ? (
              <div class="muted">Henüz post yok. İlk paylaşan sen ol.</div>
            ) : null
          }
        >
          {(p) => <Post post={p} onChange={reload} />}
        </For>
      </InfiniteList>
    </>
  );
}
