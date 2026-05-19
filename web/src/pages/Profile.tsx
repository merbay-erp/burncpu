import { createResource, createSignal, createEffect, For, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { api, type Profile, type PostView } from '../api';
import Post from '../components/Post';
import { me } from '../auth';
import { relTime } from '../util';
import { pushToast } from '../components/Toast';

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
  const [following, setFollowing] = createSignal<boolean | null>(null);
  const [busy, setBusy] = createSignal(false);

  // 19 May 2026 — Sayfa yuklendiginde profile.is_following backend'den geldiginde
  // local state'e push et. Onceden setFollowing(null) hep null kaliyordu →
  // refresh sonrasi UI "Takip Et" gosteriyordu (zaten takip ediyor olsa bile).
  createEffect(() => {
    const p = profile();
    if (p) setFollowing(p.is_following);
  });

  const follow = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      if (following()) {
        await api.del(`/users/${params.username}/follow`);
        setFollowing(false);
      } else {
        await api.post(`/users/${params.username}/follow`);
        setFollowing(true);
      }
      refetchProfile();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Show when={profile.error}>
        <p class="error">Profil bulunamadı.</p>
      </Show>
      <Show when={!profile.error && !profile()}>
        <p class="muted">Yükleniyor…</p>
      </Show>
      <Show when={profile()}>
        {(p) => (
          <>
            <header class="profile-head">
              <h1 class="profile-name">
                {p().display_name}{' '}
                <Show when={p().role === 'admin'}>
                  <span class="tiny muted" style="font-weight: 400;">
                    · admin
                  </span>
                </Show>
              </h1>
              <div class="profile-handle">@{p().username}</div>
              <Show when={p().bio}>
                <div class="profile-bio">{p().bio}</div>
              </Show>
              <div class="profile-stats">
                <span>
                  <strong>{p().counts.posts}</strong> post
                </span>
                <span>
                  <strong>{p().counts.followers}</strong> takipçi
                </span>
                <span>
                  <strong>{p().counts.following}</strong> takip
                </span>
                <span class="muted tiny">katıldı {relTime(p().created_at)}</span>
              </div>
              <Show when={me() && me()!.username !== p().username}>
                <div style="margin-top: 12px;" class="flex">
                  <button onClick={follow} disabled={busy()}>
                    {following() ? 'Takipten çık' : 'Takip et'}
                  </button>
                  {/* 19 May 2026 — Mute butonu state-aware: zaten mute ise "Mute kaldır"
                      gosterir, alert() yerine pushToast kullanir, refetch ile UI guncel kalir. */}
                  <button
                    onClick={async () => {
                      const isMuted = p().is_muted_by_viewer;
                      if (isMuted) {
                        try {
                          await api.del(`/users/${p().username}/mute`);
                          pushToast('Mute kaldırıldı', 'ok');
                          refetchProfile();
                        } catch (e) { pushToast((e as Error).message, 'warn'); }
                      } else {
                        if (!confirm(`@${p().username} mute edilsin mi? (sessizce, kullanıcı bilmez)`)) return;
                        try {
                          await api.post(`/users/${p().username}/mute`);
                          pushToast('Mute aktif', 'ok');
                          refetchProfile();
                        } catch (e) { pushToast((e as Error).message, 'warn'); }
                      }
                    }}
                  >
                    {p().is_muted_by_viewer ? '🔊 Mute kaldır' : '🔇 Mute'}
                  </button>
                  <button
                    style="color: var(--bad);"
                    onClick={async () => {
                      const isBlocked = p().is_blocked_by_viewer;
                      if (isBlocked) {
                        try {
                          await api.del(`/users/${p().username}/block`);
                          pushToast('Blok kaldırıldı', 'ok');
                          refetchProfile();
                        } catch (e) { pushToast((e as Error).message, 'warn'); }
                      } else {
                        if (!confirm(`@${p().username} BLOK edilsin mi? Mevcut takipler de kalkacak.`)) return;
                        try {
                          await api.post(`/users/${p().username}/block`);
                          pushToast('Blok aktif', 'ok');
                          refetchProfile();
                        } catch (e) { pushToast((e as Error).message, 'warn'); }
                      }
                    }}
                  >
                    {p().is_blocked_by_viewer ? '✓ Blok kaldır' : '⛔ Blok'}
                  </button>
                </div>
              </Show>
            </header>
            <Show when={pinned()}>
              {(pp) => (
                <>
                  <h3 style="margin-top: 22px; display: flex; align-items: center; gap: 8px;">
                    📌 Sabitlenmiş
                    <Show when={me()?.username === p().username}>
                      <button class="ghost tiny" onClick={unpin}>kaldır</button>
                    </Show>
                  </h3>
                  <Post post={pp() as PostView} />
                </>
              )}
            </Show>
            <h2 class="page-title" style="margin-top: 22px;">
              Postlar
            </h2>
          </>
        )}
      </Show>
      <Show when={posts()}>
        {(list) => (
          <For each={list()} fallback={<div class="muted">Henüz post yok.</div>}>
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
                  {post.reactions_count} tepki · {post.replies_count} reply
                </div>
              </article>
            )}
          </For>
        )}
      </Show>
    </>
  );
}
