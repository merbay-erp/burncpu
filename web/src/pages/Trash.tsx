import { createResource, For, Show } from 'solid-js';
import AuthGate from '../components/AuthGate';
import { api } from '../api';
import { me } from '../auth';
import { relTime } from '../util';
import Avatar from '../components/Avatar';
import { RowSkeletonList } from '../components/Skeleton';
import { t } from '../i18n';

interface TrashedPost {
  id: string;
  body: string;
  deleted_at: string;
  created_at: string;
}

export default function Trash() {
  const [list, { refetch }] = createResource<TrashedPost[] | null>(async () => {
    if (!me()) return null;
    return api.get<TrashedPost[]>('/users/me/trash');
  });

  const restore = async (id: string) => {
    await api.post(`/posts/${id}/restore`);
    refetch();
  };

  const daysLeft = (d: string): number =>
    Math.max(0, 30 - Math.floor((Date.now() - Date.parse(d)) / 86400000));

  return (
    <div>
      <h1 class="text-[24px] md:text-[28px] font-bold tracking-tight text-on-background mb-1">{t('nav.trash')}</h1>
      <p class="text-on-surface-variant font-mono text-[12px] mb-5">{t('trash.retention_note')}</p>

      <Show
        when={me()}
        fallback={<AuthGate icon="delete" title={t('auth.gate.trash')} />}
      >
        <Show when={list()} fallback={<RowSkeletonList count={4} />}>
          {(rows) => (
            <Show
              when={rows().length > 0}
              fallback={
                <div class="p-10 border border-dashed border-outline-variant rounded-2xl text-center">
                  <div class="text-[32px] mb-2">🗑️</div>
                  <p class="text-on-surface-variant font-mono text-[14px]">{t('trash.empty')}</p>
                </div>
              }
            >
              <div class="space-y-3">
                <For each={rows()}>
                  {(p) => (
                    <article class="p-4 bg-surface-container-low border border-outline-variant rounded-2xl">
                      <div class="flex gap-3">
                        <Avatar url={me()?.avatar_url} name={me()?.display_name} size={36} class="rounded-xl opacity-60" />
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2 text-[12px] font-mono mb-1.5">
                            <span class="text-on-surface-variant">{t('trash.deleted_prefix')} {relTime(p.deleted_at)}</span>
                            <span class={`ml-auto ${daysLeft(p.deleted_at) <= 3 ? 'text-error' : 'text-on-surface-variant/70'}`}>
                              {daysLeft(p.deleted_at)} {t('trash.days_left')}
                            </span>
                          </div>
                          <p class="text-on-surface/80 text-[14px] leading-relaxed line-clamp-3 whitespace-pre-wrap break-words">
                            {p.body}
                          </p>
                          <button
                            onClick={() => restore(p.id)}
                            class="mt-3 px-3 py-1.5 rounded-lg bg-primary text-on-primary font-bold font-mono text-[12px] hover:opacity-90 active:scale-95 transition-all inline-flex items-center gap-1.5"
                          >
                            <span class="material-symbols-outlined" style="font-size:15px;">restore</span> {t('trash.restore')}
                          </button>
                        </div>
                      </div>
                    </article>
                  )}
                </For>
              </div>
            </Show>
          )}
        </Show>
      </Show>
    </div>
  );
}
