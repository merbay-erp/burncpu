import { createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js';
import AuthGate from '../components/AuthGate';
import { api, type Timeline, type PostView } from '../api';
import Post from '../components/Post';
import Compose from '../components/Compose';
import InfiniteList from '../components/InfiniteList';
import { PostSkeletonList } from '../components/Skeleton';
import TimelineTabs from '../components/TimelineTabs';
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
        : '?limit=12';
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
  // Load the first page as soon as we know who's logged in — don't wait for the
  // infinite-scroll sentinel (the loading skeletons push it below the fold).
  createEffect(() => {
    if (me() && !initialized() && !loading()) void loadMore();
  });
  // Global compose FAB broadcasts new posts — your own show in your feed live.
  onMount(() => {
    const onPosted = (e: Event) => {
      const p = (e as CustomEvent).detail as PostView;
      if (p?.visibility !== 'private') prepend(p);
    };
    window.addEventListener('burncpu:posted', onPosted);
    onCleanup(() => window.removeEventListener('burncpu:posted', onPosted));
  });
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
      <TimelineTabs />
      <Show
        when={me()}
        fallback={<AuthGate icon="dynamic_feed" title={t('feed.login_required')} />}
      >
        <Compose persistDraft onPosted={prepend} />
        <InfiniteList onLoadMore={loadMore} loading={loading()} done={done()}>
          <For
            each={posts()}
            fallback={
              initialized() ? (
                <div class="p-6 border border-dashed border-outline-variant rounded-xl text-on-surface-variant font-mono text-[14px] text-center">
                  {t('feed.empty')}
                </div>
              ) : (
                <PostSkeletonList count={5} />
              )
            }
          >
            {(p, i) => <Post post={p} eager={i() === 0} onChange={reload} />}
          </For>
        </InfiniteList>
      </Show>
    </>
  );
}
