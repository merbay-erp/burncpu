import { createResource, createSignal, For, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { api, type Profile } from '../api';
import { me } from '../auth';
import { relTime } from '../util';

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
  const [following, setFollowing] = createSignal<boolean | null>(null);
  const [busy, setBusy] = createSignal(false);

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
                <div style="margin-top: 12px;">
                  <button onClick={follow} disabled={busy()}>
                    {following() ? 'Takipten çık' : 'Takip et'}
                  </button>
                </div>
              </Show>
            </header>
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
