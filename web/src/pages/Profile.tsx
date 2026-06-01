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
    () => profile()?.pinned_post_id ?? null as unknown as string,
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
  // 19 May 2026 — Follow state: backend (profile.is_following) authoritative on
  // load, but once the user toggles, the optimistic override wins so a trailing
  // refetchProfile() (read-after-write lag, or out-of-order double-click) can't
  // snap the button back to the stale pre-click value. Override resets to null
  // when we navigate to a *different* profile so it re-derives from that user.
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

  return (
    <div class="legacy">
      <Show when={profile.error}>
        <p class="error">{t('profile.not_found')}</p>
      </Show>
      <Show when={!profile.error && !profile()}>
        <p class="muted">{t('loading')}</p>
      </Show>
      <Show when={profile()}>
        {(p) => (
          <>
            <header class="profile-head">
              <h1 class="profile-name">
                {p().display_name}{' '}
                <Show when={p().role === 'admin'}>
                  <span class="tiny muted" style="font-weight: 400;">
                    · {t('profile.admin')}
                  </span>
                </Show>
              </h1>
              <div class="profile-handle">@{p().username}</div>
              <Show when={p().bio}>
                <div class="profile-bio">{p().bio}</div>
              </Show>
              <div class="profile-stats">
                <span>
                  <strong>{p().counts.posts}</strong> {t('profile.posts_count')}
                </span>
                <A href={`/u/${p().username}/followers`}>
                  <strong>{p().counts.followers}</strong> {t('profile.followers')}
                </A>
                <A href={`/u/${p().username}/following`}>
                  <strong>{p().counts.following}</strong> {t('profile.following')}
                </A>
                <span class="muted tiny">{t('profile.joined')} {relTime(p().created_at)}</span>
              </div>
              <Show when={me() && me()!.username !== p().username}>
                <div style="margin-top: 12px;" class="flex">
                  <button onClick={follow} disabled={busy()}>
                    {following() ? t('profile.unfollow') : t('profile.follow')}
                  </button>
                  <A href={`/dm/${p().username}`} class="primary" style="text-decoration: none;">
                    💬 {t('nav.dm')}
                  </A>
                  {/* 19 May 2026 — Mute butonu state-aware: zaten mute ise "Mute kaldır"
                      gosterir, alert() yerine pushToast kullanir, refetch ile UI guncel kalir. */}
                  <button
                    onClick={async () => {
                      const isMuted = p().is_muted_by_viewer;
                      if (isMuted) {
                        try {
                          await api.del(`/users/${p().username}/mute`);
                          pushToast(t('profile.mute_removed'), 'ok');
                          refetchProfile();
                        } catch (e) { pushToast((e as Error).message, 'warn'); }
                      } else {
                        if (!confirm(`@${p().username} ${t('profile.mute_confirm')}`)) return;
                        try {
                          await api.post(`/users/${p().username}/mute`);
                          pushToast(t('profile.mute_active'), 'ok');
                          refetchProfile();
                        } catch (e) { pushToast((e as Error).message, 'warn'); }
                      }
                    }}
                  >
                    {p().is_muted_by_viewer ? `🔊 ${t('profile.unmute')}` : `🔇 ${t('profile.mute')}`}
                  </button>
                  <button
                    style="color: var(--bad);"
                    onClick={async () => {
                      const isBlocked = p().is_blocked_by_viewer;
                      if (isBlocked) {
                        try {
                          await api.del(`/users/${p().username}/block`);
                          pushToast(t('profile.block_removed'), 'ok');
                          refetchProfile();
                        } catch (e) { pushToast((e as Error).message, 'warn'); }
                      } else {
                        if (!confirm(`@${p().username} ${t('profile.block_confirm')}`)) return;
                        try {
                          await api.post(`/users/${p().username}/block`);
                          pushToast(t('profile.block_active'), 'ok');
                          refetchProfile();
                        } catch (e) { pushToast((e as Error).message, 'warn'); }
                      }
                    }}
                  >
                    {p().is_blocked_by_viewer ? `✓ ${t('profile.unblock')}` : `⛔ ${t('profile.block')}`}
                  </button>
                </div>
              </Show>
            </header>
            <Show when={pinned()}>
              {(pp) => (
                <>
                  <h3 style="margin-top: 22px; display: flex; align-items: center; gap: 8px;">
                    📌 {t('profile.pinned')}
                    <Show when={me()?.username === p().username}>
                      <button class="ghost tiny" onClick={unpin}>{t('profile.unpin')}</button>
                    </Show>
                  </h3>
                  <Post post={pp() as PostView} />
                </>
              )}
            </Show>
            <h2 class="page-title" style="margin-top: 22px;">
              {t('profile.posts_heading')}
            </h2>
          </>
        )}
      </Show>
      <Show when={posts()}>
        {(list) => (
          <For each={list()} fallback={<div class="muted">{t('profile.no_posts')}</div>}>
            {(post) => (
              <article class="post">
                <div class="post-head">
                  <a
                    href={`/posts/${post.id}`}
                    class="time"
                    style="color: var(--fg-3); margin-left: auto;"
                  >
                    {relTime(post.created_at)}
                  </a>
                </div>
                <div class="post-body" innerHTML={post.body_html} />
                <div class="post-foot tiny muted">
                  {post.reactions_count} {t('profile.reactions')} · {post.replies_count} {t('profile.replies')}
                </div>
              </article>
            )}
          </For>
        )}
      </Show>
    </div>
  );
}
