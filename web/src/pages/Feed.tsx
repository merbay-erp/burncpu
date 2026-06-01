import { createSignal, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api, type Timeline, type PostView } from '../api';
import Post from '../components/Post';
import Compose from '../components/Compose';
import InfiniteList from '../components/InfiniteList';
import { me } from '../auth';
import { t } from '../i18n';

export default function Feed() {
  const [posts, setPosts] = createSignal<PostView[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [cursorId, setCursorId] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [initialized, setInitialized] = createSignal(false);

  const loadMore = async () => {
    if (!me() || loading() || done()) return;
    setLoading(true);
    try {
      const qs = cursor()
        ? `?limit=30&before=${encodeURIComponent(cursor()!)}${cursorId() ? `&before_id=${encodeURIComponent(cursorId()!)}` : ''}`
        : '?limit=30';
      const page = await api.get<Timeline>(`/feed${qs}`);
      setPosts((cur) => [...cur, ...page.posts]);
      if (page.next_before && page.posts.length > 0) {
        setCursor(page.next_before);
        setCursorId(page.next_before_id ?? null);
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
    setCursorId(null);
    setDone(false);
    setInitialized(false);
    await loadMore();
  };

  return (
    <>
      <h2 class="page-title">
        {t('feed.title')} <small>{t('feed.subtitle')}</small>
      </h2>
      <Show
        when={me()}
        fallback={
          <p class="muted">
            <A href="/login">{t('feed.login_required')}</A>
          </p>
        }
      >
        <Compose onPosted={prepend} />
        <InfiniteList onLoadMore={loadMore} loading={loading()} done={done()}>
          <For
            each={posts()}
            fallback={
              initialized() ? (
                <div class="muted">{t('feed.empty')}</div>
              ) : null
            }
          >
            {(p) => <Post post={p} onChange={reload} />}
          </For>
        </InfiniteList>
      </Show>
    </>
  );
}
