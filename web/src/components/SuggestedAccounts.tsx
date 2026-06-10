import { createResource, createSignal, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api } from '../api';
import { t } from '../i18n';

interface Suggested {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  followers_count: number;
}

// "Who to follow" — the onboarding nudge. A new account follows no one, so the
// feed is empty; this turns that dead end into one-tap follows of the accounts
// worth following first (server-ranked by activity + followers). Renders nothing
// when the API has no suggestions, so it never shows an empty shell.
export default function SuggestedAccounts(props: { limit?: number; title?: string }) {
  const [data] = createResource(() =>
    api
      .get<Suggested[]>(`/users/suggestions?limit=${props.limit ?? 5}`)
      .catch(() => [] as Suggested[]),
  );
  // Track local follows so the button flips instantly, no refetch.
  const [followed, setFollowed] = createSignal<Record<string, boolean>>({});

  const follow = async (u: Suggested) => {
    setFollowed((m) => ({ ...m, [u.username]: true }));
    try {
      await api.post(`/users/${u.username}/follow`);
    } catch {
      setFollowed((m) => ({ ...m, [u.username]: false }));
    }
  };

  return (
    <Show when={(data() ?? []).length > 0}>
      <section class="rounded-2xl border border-outline-variant bg-surface-container-low p-4">
        <h3 class="font-bold text-on-surface text-body-md">{props.title ?? t('suggest.title')}</h3>
        <p class="text-on-surface-variant text-body-sm mt-0.5 mb-3">{t('suggest.subtitle')}</p>
        <div class="flex flex-col">
          <For each={data()}>
            {(u) => (
              <div class="flex items-center gap-3 py-2">
                <A href={`/u/${u.username}`} class="shrink-0">
                  <Show
                    when={u.avatar_url}
                    fallback={
                      <div class="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-[18px]">
                        🐢
                      </div>
                    }
                  >
                    <img src={u.avatar_url!} alt="" class="w-10 h-10 rounded-full object-cover" />
                  </Show>
                </A>
                <A href={`/u/${u.username}`} class="min-w-0 flex-1">
                  <div class="font-semibold text-on-surface text-body-md truncate">
                    {u.display_name || u.username}
                  </div>
                  <div class="text-on-surface-variant text-body-sm truncate">@{u.username}</div>
                </A>
                <button
                  type="button"
                  disabled={!!followed()[u.username]}
                  onClick={() => follow(u)}
                  class={`shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-bold transition-colors ${
                    followed()[u.username]
                      ? 'border border-outline-variant text-on-surface-variant'
                      : 'bg-primary text-on-primary hover:opacity-95 active:scale-95'
                  }`}
                >
                  {followed()[u.username] ? t('suggest.following') : t('suggest.follow')}
                </button>
              </div>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}
