import { createResource, createSignal, For, Show } from 'solid-js';
import { useParams, A } from '@solidjs/router';
import { api, ApiError, type PostView } from '../api';
import Post from '../components/Post';
import Compose from '../components/Compose';
import { me } from '../auth';

interface ThreadResponse {
  root: PostView;
  descendants: PostView[];
}

type Result = { ok: ThreadResponse } | { err: 'not_found' | 'other' };

export default function PostDetail() {
  const params = useParams<{ id: string }>();
  const [thread, { refetch, mutate }] = createResource<Result, string>(
    () => params.id,
    async (id: string): Promise<Result> => {
      try {
        const r = await api.get<ThreadResponse>(`/posts/${id}/thread`);
        return { ok: r };
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return { err: 'not_found' };
        return { err: 'other' };
      }
    },
  );
  const [showReply, setShowReply] = createSignal(false);

  const appendDescendant = (p: PostView) => {
    const cur = thread();
    if (!cur || 'err' in cur) return;
    mutate({ ok: { root: cur.ok.root, descendants: [...cur.ok.descendants, p] } });
    setShowReply(false);
  };

  const isOk = (r: Result | undefined): r is { ok: ThreadResponse } =>
    !!r && 'ok' in r;
  const isErr = (r: Result | undefined): r is { err: 'not_found' | 'other' } =>
    !!r && 'err' in r;

  return (
    <>
      <h2 class="page-title">Konuşma</h2>
      <Show when={thread.loading}>
        <p class="muted">Yükleniyor…</p>
      </Show>
      <Show when={isErr(thread())}>
        <div class="error">
          <Show
            when={(thread() as { err: string }).err === 'not_found'}
            fallback={<>Bir şey ters gitti.</>}
          >
            Bu post artık yok (silinmiş ya da hiç olmamış).
          </Show>
        </div>
        <p><A href="/">← ana sayfaya dön</A></p>
      </Show>
      <Show when={isOk(thread()) ? (thread() as { ok: ThreadResponse }).ok : null}>
        {(t) => (
          <>
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
    </>
  );
}
