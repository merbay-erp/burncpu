// Right sidebar — Profile card + Trending Signals + Grid Status.
// Matches the timeline_dark_mode reference. Desktop-XL only.

import { createResource, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api, type Profile } from '../api';
import { me } from '../auth';

interface TagCount { tag: string; count: number }

const CATEGORY_LABEL = (idx: number): string => {
  // Pure decoration — labels seen in the reference
  const tags = ['Hardware', 'Infrastructure', 'Protocol', 'Economy', 'Topic', 'Signal'];
  return tags[idx] ?? 'Topic';
};

export default function RightRail() {
  const [profile] = createResource<Profile | null>(async () => {
    const u = me();
    if (!u) return null;
    try { return await api.get<Profile>(`/users/${u.username}`); } catch { return null; }
  });

  const [tags] = createResource<TagCount[]>(async () => {
    try { return await api.get<TagCount[]>('/trending/hashtags?window=24h&limit=4'); }
    catch { return []; }
  });

  return (
    <aside class="sticky top-16 h-[calc(100vh-4rem)] flex flex-col py-8 px-6 gap-8 border-l border-outline-variant bg-background overflow-y-auto">
      <Show when={profile()}>
        {(p) => (
          <section class="bg-surface-container-high border border-outline-variant rounded-xl p-5">
            <div class="flex items-center gap-4 mb-4">
              <div class="w-14 h-14 bg-surface-container-highest rounded-full flex items-center justify-center text-[28px] border-2 border-primary overflow-hidden">
                <Show when={p().avatar_url} fallback={<>🐢</>}>
                  <img src={p().avatar_url!} alt="" class="w-full h-full object-cover" />
                </Show>
              </div>
              <div class="min-w-0">
                <h3 class="font-bold text-on-background truncate">{p().display_name}</h3>
                <p class="text-on-surface-variant text-[12px] font-mono">@{p().username}</p>
              </div>
            </div>
            <div class="grid grid-cols-3 gap-2 py-3 border-y border-outline-variant/30">
              <A href={`/u/${p().username}`} class="text-center group">
                <div class="font-bold text-on-background group-hover:text-primary transition-colors">{p().counts.posts}</div>
                <div class="text-[10px] text-on-surface-variant uppercase tracking-widest font-mono">Signals</div>
              </A>
              <A href={`/u/${p().username}/followers`} class="text-center group">
                <div class="font-bold text-on-background group-hover:text-primary transition-colors">{p().counts.followers}</div>
                <div class="text-[10px] text-on-surface-variant uppercase tracking-widest font-mono">Nodes</div>
              </A>
              <A href={`/u/${p().username}/following`} class="text-center group">
                <div class="font-bold text-on-background group-hover:text-primary transition-colors">{p().counts.following}</div>
                <div class="text-[10px] text-on-surface-variant uppercase tracking-widest font-mono">Tracks</div>
              </A>
            </div>
            <A
              href="/settings"
              class="w-full mt-4 py-2 border border-primary text-primary font-bold rounded-lg text-[14px] font-mono hover:bg-primary/10 transition-colors flex items-center justify-center"
            >
              Edit Profile
            </A>
          </section>
        )}
      </Show>

      <section>
        <h3 class="font-mono text-[14px] text-primary font-bold uppercase tracking-widest mb-4">Trending Signals</h3>
        <div class="space-y-4">
          <Show when={tags()} fallback={<p class="text-on-surface-variant text-[12px] font-mono">scanning…</p>}>
            {(rows) => (
              <For
                each={rows()}
                fallback={<p class="text-on-surface-variant text-[12px] font-mono">no signal in this window.</p>}
              >
                {(t, i) => (
                  <A href={`/hashtag/${t.tag}`} class="group block">
                    <div class="text-on-surface-variant text-[12px] font-mono">
                      {String(i() + 1).padStart(2, '0')} · {CATEGORY_LABEL(i())}
                    </div>
                    <div class="font-bold text-on-background group-hover:text-primary transition-colors">
                      #{t.tag}
                    </div>
                    <div class="text-[12px] text-on-surface-variant">{t.count} Transmissions</div>
                  </A>
                )}
              </For>
            )}
          </Show>
        </div>
        <A href="/search" class="block mt-6 text-primary text-[12px] font-mono hover:underline">
          Show more
        </A>
      </section>

      <section class="mt-auto">
        <div class="p-4 bg-surface-container-lowest border border-outline-variant rounded-xl">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant">Grid Status</span>
            <span class="flex items-center gap-1.5 text-[10px] font-mono text-primary">
              <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
              NOMINAL
            </span>
          </div>
          <div class="h-1 bg-surface-container-highest rounded-full overflow-hidden">
            <div class="h-full bg-primary" style="width: 94%;"></div>
          </div>
          <div class="mt-2 flex justify-between text-[10px] font-mono text-on-surface-variant">
            <span>1 VPS</span>
            <span>burncpu.com</span>
          </div>
        </div>
      </section>
    </aside>
  );
}
