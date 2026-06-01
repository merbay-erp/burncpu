import { createResource, createSignal, createEffect, For, Show } from 'solid-js';
import { useParams, A } from '@solidjs/router';
import { api, type Profile, type PostView } from '../api';
import Post from '../components/Post';
import { me } from '../auth';
import { relTime } from '../util';
import { pushToast } from '../components/Toast';
import { t } from '../i18n';

interface BriefPost {
  id: string;
  body: string;
  body_html: string;
  reactions_count: number;
  replies_count: number;
  created_at: string;
}

export default function ProfilePage() {
  const params = useParams<{ username: string }>();
  const [profile, { refetch: refetchProfile }] = createResource<Profile, string>(
    () => params.username,
    (u) => api.get<Profile>(`/users/${u}`),
  );
  const [posts] = createResource<BriefPost[], string>(
    () => params.username,
    (u) => api.get<BriefPost[]>(`/users/${u}/posts?limit=50`),
  );
  const [pinned, { refetch: refetchPinned }] = createResource<PostView | null, string>(
    () => profile()?.pinned_post_id ?? (null as unknown as string),
    async (id: string) => {
      try { return await api.get<PostView>(`/posts/${id}`); } catch { return null; }
    },
  );
  const unpin = async () => {
    const p = profile();
    if (!p?.pinned_post_id) return;
    await api.del(`/users/me/pin/${p.pinned_post_id}`);
    refetchProfile();
    refetchPinned();
  };

  // Follow state: backend authoritative on load, optimistic override wins after
  // a click so a trailing refetch can't snap the button back. Reset on nav.
  const [followOverride, setFollowOverride] = createSignal<boolean | null>(null);
  const [busy, setBusy] = createSignal(false);

  createEffect<string | undefined>((prevUser) => {
    const u = params.username;
    if (prevUser !== undefined && prevUser !== u) setFollowOverride(null);
    return u;
  });

  const following = () => followOverride() ?? profile()?.is_following ?? false;

  const follow = async () => {
    if (busy()) return;
    setBusy(true);
    const wasFollowing = following();
    try {
      if (wasFollowing) {
        await api.del(`/users/${params.username}/follow`);
        setFollowOverride(false);
      } else {
        await api.post(`/users/${params.username}/follow`);
        setFollowOverride(true);
      }
      refetchProfile();
    } finally {
      setBusy(false);
    }
  };

  const toggleMute = async () => {
    try {
      if (profile()?.is_muted_by_viewer) {
        await api.del(`/users/${params.username}/mute`);
        pushToast(t('profile.mute_removed'), 'ok');
      } else {
        if (!confirm(`@${params.username} ${t('profile.mute_confirm')}`)) return;
        await api.post(`/users/${params.username}/mute`);
        pushToast(t('profile.mute_active'), 'ok');
      }
      refetchProfile();
    } catch (e) { pushToast((e as Error).message, 'warn'); }
  };

  const toggleBlock = async () => {
    try {
      if (profile()?.is_blocked_by_viewer) {
        await api.del(`/users/${params.username}/block`);
        pushToast(t('profile.block_removed'), 'ok');
      } else {
        if (!confirm(`@${params.username} ${t('profile.block_confirm')}`)) return;
        await api.post(`/users/${params.username}/block`);
        pushToast(t('profile.block_active'), 'ok');
      }
      refetchProfile();
    } catch (e) { pushToast((e as Error).message, 'warn'); }
  };

  // The profile post-list endpoint returns lean rows (no author) — synthesize a
  // PostView from the profile so we can reuse the full <Post> card (reactions,
  // replies, link previews, menu) instead of a separate read-only mini-card.
  const briefToPostView = (b: BriefPost, pr: Profile): PostView => ({
    id: b.id,
    author: { id: pr.id, username: pr.username, display_name: pr.display_name },
    body: b.body,
    body_html: b.body_html,
    visibility: 'public',
    reply_to_id: null,
    reactions_count: b.reactions_count,
    replies_count: b.replies_count,
    created_at: b.created_at,
  });

  return (
    <div>
      <Show when={profile.error}>
        <div class="p-6 border border-dashed border-outline-variant rounded-2xl text-on-surface-variant font-mono text-center text-[14px]">
          {t('profile.not_found')}
        </div>
      </Show>
      <Show when={!profile.error && !profile()}>
        <div class="p-6 text-on-surface-variant font-mono text-center text-[14px]">{t('loading')}</div>
      </Show>

      <Show when={profile()}>
        {(p) => (
          <>
            {/* ── Header card ── */}
            <header class="relative overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-low p-6 mb-6">
              <div class="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/10 to-transparent pointer-events-none"></div>
              <div class="relative flex items-start gap-4">
                <div class="w-20 h-20 rounded-2xl bg-surface-container-highest ring-2 ring-primary/30 flex items-center justify-center text-[40px] shrink-0 overflow-hidden">
                  <Show when={p().avatar_url} fallback={<>🐢</>}>
                    <img src={p().avatar_url!} alt="" class="w-full h-full object-cover" />
                  </Show>
                </div>
                <div class="min-w-0 flex-1">
                  <h1 class="text-[22px] font-bold tracking-tight text-on-background flex items-center gap-2 flex-wrap leading-tight">
                    {p().display_name}
                    <Show when={p().role === 'admin'}>
                      <span class="px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-mono uppercase tracking-wider">
                        {t('profile.admin')}
                      </span>
                    </Show>
                  </h1>
                  <div class="text-on-surface-variant font-mono text-[13px] mt-0.5">@{p().username}</div>
                  <Show when={p().bio}>
                    <p class="mt-2 text-on-surface text-[14px] leading-relaxed whitespace-pre-wrap break-words">{p().bio}</p>
                  </Show>
                </div>
              </div>

              <div class="relative flex flex-wrap items-center gap-x-5 gap-y-1 mt-4 text-[13px]">
                <span class="text-on-surface-variant">
                  <strong class="text-on-background font-semibold">{p().counts.posts}</strong> {t('profile.posts_count')}
                </span>
                <A href={`/u/${p().username}/followers`} class="text-on-surface-variant hover:text-primary transition-colors">
                  <strong class="text-on-background font-semibold">{p().counts.followers}</strong> {t('profile.followers')}
                </A>
                <A href={`/u/${p().username}/following`} class="text-on-surface-variant hover:text-primary transition-colors">
                  <strong class="text-on-background font-semibold">{p().counts.following}</strong> {t('profile.following')}
                </A>
                <span class="text-on-surface-variant/70 font-mono text-[11px] sm:ml-auto">
                  {t('profile.joined')} {relTime(p().created_at)}
                </span>
              </div>

              <Show when={me() && me()!.username !== p().username}>
                <div class="relative flex flex-wrap items-center gap-2 mt-4">
                  <button
                    onClick={follow}
                    disabled={busy()}
                    class={
                      following()
                        ? 'px-4 py-1.5 rounded-lg border border-outline-variant text-on-background font-mono text-[13px] hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-50'
                        : 'px-5 py-1.5 rounded-lg bg-primary text-on-primary font-bold font-mono text-[13px] hover:opacity-90 active:scale-95 transition-all disabled:opacity-50'
                    }
                  >
                    {following() ? t('profile.unfollow') : t('profile.follow')}
                  </button>
                  <A
                    href={`/dm/${p().username}`}
                    class="px-3.5 py-1.5 rounded-lg border border-outline-variant text-on-background font-mono text-[13px] hover:border-primary/50 hover:text-primary transition-colors inline-flex items-center gap-1.5"
                  >
                    <span class="material-symbols-outlined" style="font-size:16px;">mail</span> {t('nav.dm')}
                  </A>
                  <button
                    onClick={toggleMute}
                    class="p-2 rounded-lg border border-outline-variant text-on-surface-variant hover:text-primary hover:border-primary/50 transition-colors"
                    title={p().is_muted_by_viewer ? t('profile.unmute') : t('profile.mute')}
                  >
                    <span class="material-symbols-outlined" style="font-size:17px;">
                      {p().is_muted_by_viewer ? 'volume_up' : 'volume_off'}
                    </span>
                  </button>
                  <button
                    onClick={toggleBlock}
                    class="p-2 rounded-lg border border-outline-variant text-error/80 hover:text-error hover:border-error/40 transition-colors"
                    title={p().is_blocked_by_viewer ? t('profile.unblock') : t('profile.block')}
                  >
                    <span class="material-symbols-outlined" style="font-size:17px;">
                      {p().is_blocked_by_viewer ? 'check' : 'block'}
                    </span>
                  </button>
                </div>
              </Show>
            </header>

            {/* ── Pinned ── */}
            <Show when={pinned()}>
              {(pp) => (
                <div class="mb-6">
                  <div class="flex items-center gap-2 mb-2 px-1">
                    <span class="material-symbols-outlined text-primary" style="font-size:17px;">push_pin</span>
                    <span class="font-mono text-[11px] uppercase tracking-widest text-on-surface-variant">{t('profile.pinned')}</span>
                    <Show when={me()?.username === p().username}>
                      <button class="ml-auto text-[12px] font-mono text-on-surface-variant hover:text-primary transition-colors" onClick={unpin}>
                        {t('profile.unpin')}
                      </button>
                    </Show>
                  </div>
                  <Post post={pp() as PostView} />
                </div>
              )}
            </Show>

            {/* ── Posts ── */}
            <h2 class="text-[18px] font-semibold text-on-background border-b border-outline-variant pb-2 mb-4">
              {t('profile.posts_heading')}
            </h2>
            <Show when={posts()}>
              {(list) => (
                <div class="space-y-6">
                  <For
                    each={list()}
                    fallback={
                      <div class="p-6 border border-dashed border-outline-variant rounded-2xl text-on-surface-variant font-mono text-center text-[14px]">
                        {t('profile.no_posts')}
                      </div>
                    }
                  >
                    {(post) => <Post post={briefToPostView(post, p())} />}
                  </For>
                </div>
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
