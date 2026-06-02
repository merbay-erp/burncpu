import { createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { api, type Timeline, type PostView } from '../api';
import Post from '../components/Post';
import Compose from '../components/Compose';
import InfiniteList from '../components/InfiniteList';
import { PostSkeletonList } from '../components/Skeleton';
import TimelineTabs from '../components/TimelineTabs';
import { me } from '../auth';
import { t } from '../i18n';

export default function Home() {
  const [posts, setPosts] = createSignal<PostView[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [cursorId, setCursorId] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [initialized, setInitialized] = createSignal(false);
  const [newCount, setNewCount] = createSignal(0);

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
  // The global compose FAB broadcasts new posts — show public ones live here.
  onMount(() => {
    // Load the first page immediately — don't wait for the infinite-scroll
    // sentinel to intersect (the loading skeletons push it below the fold, so
    // it never fired on open and the timeline sat on skeletons until a scroll).
    void loadMore();
    const onPosted = (e: Event) => {
      const p = (e as CustomEvent).detail as PostView;
      if (p?.visibility === 'public') prepend(p);
    };
    // Real-time: someone else published a public post. Don't yank the timeline
    // out from under the reader — just count and surface a "load new" pill.
    const onNew = () => setNewCount((n) => Math.min(n + 1, 99));
    window.addEventListener('burncpu:posted', onPosted);
    window.addEventListener('burncpu:newpost', onNew);
    onCleanup(() => {
      window.removeEventListener('burncpu:posted', onPosted);
      window.removeEventListener('burncpu:newpost', onNew);
    });
  });
  const reload = async () => {
    setPosts([]); setCursor(null); setCursorId(null); setDone(false); setInitialized(false);
    await loadMore();
  };
  const showNew = async () => {
    setNewCount(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await reload();
  };

  return (
    <>
      {/* Real-time "new signals" pill */}
      <Show when={newCount() > 0}>
        <div class="fixed top-[72px] inset-x-0 z-40 flex justify-center pointer-events-none">
          <button
            onClick={showNew}
            class="newpill pointer-events-auto inline-flex items-center gap-2 pl-3 pr-4 py-2 rounded-full bg-primary text-on-primary font-bold font-mono text-[13px] shadow-lg shadow-primary/30 hover:opacity-95 active:scale-95 transition-all"
          >
            <span class="material-symbols-outlined" style="font-size:18px;">arrow_upward</span>
            {newCount()} {t('home.new_signals')}
          </button>
        </div>
      </Show>

      <TimelineTabs />

      <Show when={me()}>
        <Compose persistDraft onPosted={prepend} />
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
              ) : (
                <PostSkeletonList count={5} />
              )
            }
          >
            {(p) => <Post post={p} onChange={reload} />}
          </For>
        </div>
      </InfiniteList>
    </>
  );
}
