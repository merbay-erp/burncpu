import { createResource, For, Show } from 'solid-js';
import { api, type Timeline, type PostView } from '../api';
import Post from '../components/Post';
import Compose from '../components/Compose';
import { me } from '../auth';

export default function Home() {
  const [timeline, { refetch, mutate }] = createResource<Timeline>(() =>
    api.get<Timeline>('/posts?limit=50'),
  );

  const prepend = (p: PostView) => {
    const cur = timeline();
    if (!cur) return;
    mutate({ posts: [p, ...cur.posts], next_before: cur.next_before });
  };

  return (
    <>
      <h2 class="page-title">
        Public timeline <small>herkesin paylaştığı</small>
      </h2>
      <Show when={me()}>
        <Compose onPosted={prepend} />
      </Show>
      <Show when={timeline()} fallback={<div class="muted">Yükleniyor…</div>}>
        {(t) => (
          <For
            each={t().posts}
            fallback={<div class="muted">Henüz post yok. İlk paylaşan sen ol.</div>}
          >
            {(p) => <Post post={p} onChange={refetch} />}
          </For>
        )}
      </Show>
    </>
  );
}
