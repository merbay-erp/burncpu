import { createSignal, For, Show, onMount } from 'solid-js';
import { api } from '../api';
import { relTime } from '../util';
import { PostSkeletonList } from '../components/Skeleton';
import { t } from '../i18n';

// The federated "explore" timeline — posts the instance has *consumed* from the
// fediverse (remote Create + Announce, ingested server-side, sanitized with the
// same ammonia allowlist as local content). Distinct from the local timelines:
// these are read-only, off-instance posts, so there are no reactions / replies /
// viewer state — just the author, the body, and a link back to the origin.

interface RemotePost {
  uri: string;
  actor_uri: string;
  actor_handle: string | null;
  actor_name: string | null;
  actor_avatar: string | null;
  content_html: string;
  url: string | null;
  published_at: string;
}

interface FederatedResponse {
  posts: RemotePost[];
  next_before: string | null;
}

export default function Federated() {
  const [posts, setPosts] = createSignal<RemotePost[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [ready, setReady] = createSignal(false);

  async function load(before?: string | null) {
    if (loading()) return;
    setLoading(true);
    try {
      const qs = before ? `?before=${encodeURIComponent(before)}&limit=30` : '?limit=30';
      const res = await api.get<FederatedResponse>(`/feed/federated${qs}`);
      setPosts((prev) => (before ? [...prev, ...res.posts] : res.posts));
      setCursor(res.next_before);
      if (!res.next_before || res.posts.length === 0) setDone(true);
    } catch {
      setDone(true);
    } finally {
      setLoading(false);
      setReady(true);
    }
  }

  onMount(() => void load());

  // Best-effort display name: the actor's name, else its @handle, else the host.
  const who = (p: RemotePost) =>
    p.actor_name || p.actor_handle || hostOf(p.actor_uri) || p.actor_uri;

  return (
    <div>
      <header class="mb-6">
        <h1 class="text-[24px] md:text-[28px] font-bold tracking-tight text-on-background">
          {t('federated.title')}
        </h1>
        <p class="mt-1 text-on-surface-variant text-body-md">{t('federated.subtitle')}</p>
      </header>

      <Show when={ready()} fallback={<PostSkeletonList />}>
        <Show
          when={posts().length > 0}
          fallback={
            <div class="rounded-2xl border border-outline-variant bg-surface-container-low p-8 text-center">
              <span class="material-symbols-outlined text-[40px] text-on-surface-variant/50">hub</span>
              <p class="mt-2 text-on-surface font-medium">{t('federated.empty_title')}</p>
              <p class="mt-1 text-on-surface-variant text-body-sm max-w-md mx-auto">
                {t('federated.empty_body')}
              </p>
            </div>
          }
        >
          <div class="flex flex-col gap-3">
            <For each={posts()}>
              {(p) => (
                <article class="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4">
                  <div class="flex items-center gap-2.5">
                    <Show
                      when={p.actor_avatar}
                      fallback={
                        <div class="w-9 h-9 rounded-full bg-on-surface-variant/10 flex items-center justify-center shrink-0">
                          <span class="material-symbols-outlined text-[18px] text-on-surface-variant">public</span>
                        </div>
                      }
                    >
                      <img
                        src={p.actor_avatar!}
                        alt=""
                        loading="lazy"
                        referrerpolicy="no-referrer"
                        class="w-9 h-9 rounded-full object-cover bg-surface-container shrink-0"
                      />
                    </Show>
                    <div class="min-w-0 flex-1">
                      <div class="font-semibold text-on-surface text-body-md truncate">{who(p)}</div>
                      <Show when={p.actor_handle}>
                        <div class="text-on-surface-variant text-body-sm truncate">{p.actor_handle}</div>
                      </Show>
                    </div>
                    <time class="text-on-surface-variant/70 text-body-sm shrink-0" datetime={p.published_at}>
                      {relTime(p.published_at)}
                    </time>
                  </div>

                  <div
                    class="post-body federated-body mt-2.5 text-on-surface text-body-md break-words"
                    innerHTML={p.content_html}
                  />

                  <Show when={p.url}>
                    <a
                      href={p.url!}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      class="mt-2.5 inline-flex items-center gap-1 text-primary text-body-sm hover:underline"
                    >
                      <span class="material-symbols-outlined text-[16px]">open_in_new</span>
                      {t('federated.original')}
                    </a>
                  </Show>
                </article>
              )}
            </For>

            <Show when={!done()}>
              <button
                type="button"
                disabled={loading()}
                onClick={() => load(cursor())}
                class="mx-auto mt-2 px-5 py-2 rounded-xl border border-outline-variant bg-surface-container-low text-on-surface font-mono text-[13px] font-bold hover:bg-surface-container transition-colors disabled:opacity-50"
              >
                {loading() ? '…' : t('federated.loadmore')}
              </button>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}

function hostOf(uri: string): string | null {
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
}
