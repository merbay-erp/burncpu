import { createResource, createSignal, For, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { api, type PostView } from '../api';
import Post from '../components/Post';
import Compose from '../components/Compose';
import { me } from '../auth';

interface ThreadResponse {
  root: PostView;
  descendants: PostView[];
}

export default function PostDetail() {
  const params = useParams<{ id: string }>();
  const [thread, { refetch, mutate }] = createResource<ThreadResponse, string>(
    () => params.id,
    (id: string) => api.get<ThreadResponse>(`/posts/${id}/thread`),
  );
  const [showReply, setShowReply] = createSignal(false);

  const appendDescendant = (p: PostView) => {
    const cur = thread();
    if (!cur) return;
    mutate({ root: cur.root, descendants: [...cur.descendants, p] });
    setShowReply(false);
  };

  return (
    <Show when={thread()} fallback={<p class="muted">Yükleniyor…</p>}>
      {(t) => (
        <>
          <h2 class="page-title">Konuşma</h2>
          <Post post={t().root} onChange={refetch} />

          <Show when={me()}>
            <Show
              when={showReply()}
              fallback={
                <div style="padding: 12px 0;">
                  <button onClick={() => setShowReply(true)}>Yanıtla</button>
                </div>
              }
            >
              <Compose
                replyToId={t().root.id}
                placeholder="Yanıtın..."
                onPosted={appendDescendant}
              />
            </Show>
          </Show>

          <hr />
          <For each={t().descendants} fallback={<div class="muted">Henüz yanıt yok.</div>}>
            {(p) => <Post post={p} onChange={refetch} />}
          </For>
        </>
      )}
    </Show>
  );
}
