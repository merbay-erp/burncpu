import { createResource, createSignal, createMemo, For, Show } from 'solid-js';
import { useParams, A } from '@solidjs/router';
import { api, ApiError, type PostView } from '../api';
import Post from '../components/Post';
import Compose from '../components/Compose';
import ThreadNode, { type ThreadCtx } from '../components/ThreadNode';
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
  const [replyingTo, setReplyingTo] = createSignal<string | null>(null);

  const isOk = (r: Result | undefined): r is { ok: ThreadResponse } => !!r && 'ok' in r;
  const isErr = (r: Result | undefined): r is { err: 'not_found' | 'other' } => !!r && 'err' in r;

  // Flat descendants → child lists keyed by parent id. An orphan (its parent
  // was filtered out, e.g. a hidden mid-thread post) attaches to the root so
  // it's never dropped from the view.
  const childMap = createMemo(() => {
    const map = new Map<string, PostView[]>();
    const cur = thread();
    if (!isOk(cur)) return map;
    const { root, descendants } = cur.ok;
    const present = new Set<string>([root.id, ...descendants.map((d) => d.id)]);
    for (const d of descendants) {
      const pid = d.reply_to_id && present.has(d.reply_to_id) ? d.reply_to_id : root.id;
      const arr = map.get(pid) ?? [];
      arr.push(d);
      map.set(pid, arr);
    }
    return map;
  });
  const childrenOf = (id: string) => childMap().get(id) ?? [];
  const replyCount = () => {
    const cur = thread();
    return isOk(cur) ? cur.ok.descendants.length : 0;
  };

  const appendDescendant = (p: PostView) => {
    const cur = thread();
    if (!isOk(cur)) return;
    mutate({ ok: { root: cur.ok.root, descendants: [...cur.ok.descendants, p] } });
  };

  const ctx: ThreadCtx = {
    childrenOf,
    replyingTo,
    setReplyingTo,
    onReplied: appendDescendant,
    onChange: refetch,
    get highlightId() {
      return params.id;
    },
  };

  return (
    <>
      <div class="flex items-center gap-2 mb-4">
        <A href="/" class="text-on-surface-variant hover:text-primary" title="geri">
          <span class="material-symbols-outlined">arrow_back</span>
        </A>
        <h2 class="page-title" style="margin: 0;">Konuşma</h2>
      </div>

      <Show when={thread.loading}>
        <p class="muted">Yükleniyor…</p>
      </Show>

      <Show when={isErr(thread())}>
        <div class="p-6 border border-dashed border-outline-variant rounded-xl text-on-surface-variant text-center">
          <Show
            when={(thread() as { err: string }).err === 'not_found'}
            fallback={<>Bir şey ters gitti.</>}
          >
            Bu post artık yok (silinmiş ya da hiç olmamış).
          </Show>
          <div class="mt-3">
            <A href="/" class="text-primary">← ana sayfaya dön</A>
          </div>
        </div>
      </Show>

      <Show when={isOk(thread()) ? (thread() as { ok: ThreadResponse }).ok : null}>
        {(t) => (
          <div class="space-y-3">
            {/* Root post + its reply box */}
            <Post
              post={t().root}
              hideParent
              highlight={t().root.id === params.id}
              onReply={() => setReplyingTo(replyingTo() === t().root.id ? null : t().root.id)}
              onChange={refetch}
            />
            <Show when={me() && replyingTo() === t().root.id}>
              <Compose
                replyToId={t().root.id}
                placeholder="Yanıtın…"
                autofocus
                onPosted={(p) => {
                  appendDescendant(p);
                  setReplyingTo(null);
                }}
              />
            </Show>

            {/* Conversation tree */}
            <div class="flex items-center gap-1.5 pt-2 text-on-surface-variant font-mono text-[12px] tracking-wide">
              <span class="material-symbols-outlined" style="font-size: 16px;">forum</span>
              {replyCount()} yanıt
            </div>

            <Show
              when={childrenOf(t().root.id).length > 0}
              fallback={
                <div class="muted">
                  {me() ? 'Henüz yanıt yok — ilkini sen yaz.' : 'Henüz yanıt yok.'}
                </div>
              }
            >
              <div class="space-y-3">
                <For each={childrenOf(t().root.id)}>
                  {(child) => <ThreadNode post={child} depth={1} ctx={ctx} />}
                </For>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}
