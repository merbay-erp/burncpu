import { createResource, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api, type Timeline, type PostView } from '../api';
import Post from '../components/Post';
import Compose from '../components/Compose';
import { me } from '../auth';

export default function Feed() {
  const [data, { refetch, mutate }] = createResource<Timeline | null>(async () => {
    if (!me()) return null;
    return api.get<Timeline>('/feed?limit=50');
  });

  const prepend = (p: PostView) => {
    const cur = data();
    if (!cur) return;
    mutate({ posts: [p, ...cur.posts], next_before: cur.next_before });
  };

  return (
    <>
      <h2 class="page-title">
        Feed <small>takip ettiklerin + sen</small>
      </h2>
      <Show
        when={me()}
        fallback={
          <p class="muted">
            Feed'i görmek için <A href="/login">giriş yap</A>.
          </p>
        }
      >
        <Compose onPosted={prepend} />
        <Show when={data()} fallback={<div class="muted">Yükleniyor…</div>}>
          {(d) => (
            <For
              each={d().posts}
              fallback={
                <div class="muted">
                  Sessiz. <A href="/">Public timeline'a</A> bak ya da birini takip et.
                </div>
              }
            >
              {(p) => <Post post={p} onChange={refetch} />}
            </For>
          )}
        </Show>
      </Show>
    </>
  );
}
