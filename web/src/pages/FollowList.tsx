import { createResource, For, Show } from 'solid-js';
import { useParams, useLocation, A } from '@solidjs/router';
import { api } from '../api';

interface UserBrief {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

// Shared by /u/:username/followers and /u/:username/following — the mode is
// read from the path so one component serves both.
export default function FollowList() {
  const params = useParams<{ username: string }>();
  const loc = useLocation();
  const mode = () => (loc.pathname.endsWith('/following') ? 'following' : 'followers');
  const title = () => (mode() === 'following' ? 'Takip edilenler' : 'Takipçiler');

  const [list] = createResource(
    () => `${params.username}:${mode()}`,
    async () => {
      try {
        return await api.get<UserBrief[]>(`/users/${params.username}/${mode()}`);
      } catch {
        return [] as UserBrief[];
      }
    },
  );

  return (
    <>
      <div class="flex items-center gap-2 mb-6 border-b border-outline-variant pb-4">
        <A href={`/u/${params.username}`} class="text-on-surface-variant hover:text-primary" title="profil">
          <span class="material-symbols-outlined">arrow_back</span>
        </A>
        <div>
          <h1 class="font-headline-lg text-[22px] font-semibold text-on-background leading-none">{title()}</h1>
          <p class="text-on-surface-variant font-mono text-[12px] mt-1">@{params.username}</p>
        </div>
      </div>

      <Show
        when={list()}
        fallback={<p class="text-on-surface-variant font-mono text-[14px]"><span class="spinner mr-2" />SCANNING…</p>}
      >
        {(rows) => (
          <div class="space-y-2">
            <For
              each={rows()}
              fallback={
                <div class="p-6 border border-dashed border-outline-variant rounded-xl text-on-surface-variant font-mono text-[14px] text-center">
                  {mode() === 'following' ? 'Henüz kimseyi takip etmiyor.' : 'Henüz takipçi yok.'}
                </div>
              }
            >
              {(u) => (
                <A
                  href={`/u/${u.username}`}
                  class="flex items-center gap-3 p-4 bg-surface-container-low border border-outline-variant rounded-xl hover:border-primary/50 transition-colors"
                >
                  <div class="w-11 h-11 rounded-lg bg-surface-container-highest flex items-center justify-center text-[20px] text-primary overflow-hidden shrink-0">
                    <Show when={u.avatar_url} fallback={<>🐢</>}>
                      <img src={u.avatar_url!} alt="" class="w-full h-full object-cover" />
                    </Show>
                  </div>
                  <div class="min-w-0">
                    <div class="font-bold text-on-background truncate">{u.display_name}</div>
                    <div class="text-on-surface-variant font-mono text-[12px] truncate">@{u.username}</div>
                  </div>
                </A>
              )}
            </For>
          </div>
        )}
      </Show>
    </>
  );
}
