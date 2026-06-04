import { createMemo, createResource, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import AuthGate from '../components/AuthGate';
import { api } from '../api';
import { me, refetchDmUnread } from '../auth';
import { relTime } from '../util';
import { RowSkeletonList } from '../components/Skeleton';
import { t } from '../i18n';

interface ThreadSummary {
  id: string;
  other_id: string;
  other_username: string;
  other_display_name: string;
  other_avatar_url: string | null;
  last_body: string | null;
  last_sender_id: string | null;
  last_message_at: string;
  unread_count: number;
}

interface UserBrief {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

function Avatar(props: { url: string | null; size?: string }) {
  return (
    <div
      class={`${props.size ?? 'w-12 h-12'} rounded-xl bg-surface-container-highest flex items-center justify-center text-[22px] text-primary overflow-hidden shrink-0 border border-outline-variant/40`}
    >
      <Show when={props.url} fallback={<>🐢</>}>
        <img src={props.url!} alt="" class="w-full h-full object-cover" />
      </Show>
    </div>
  );
}

const NEW_BTN =
  'flex items-center gap-1.5 px-4 py-2 bg-primary text-on-primary font-bold rounded-lg font-mono text-[13px] hover:opacity-90 active:scale-95 transition-all';

export default function DMs() {
  const navigate = useNavigate();
  const [list, { refetch }] = createResource<ThreadSummary[] | null>(async () => {
    if (!me()) return null;
    return api.get<ThreadSummary[]>('/dm/threads');
  });

  // New-message composer
  const [composing, setComposing] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<UserBrief[]>([]);
  // Conversation filter
  const [filter, setFilter] = createSignal('');
  let lookupTimer: ReturnType<typeof setTimeout> | undefined;
  // Delete-conversation (select / bulk)
  const [selectMode, setSelectMode] = createSignal(false);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());

  const toggleSel = (id: string) => {
    const s = new Set(selected());
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };
  const deleteThread = async (username: string, e?: Event) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!confirm(t('dm.delete_confirm'))) return;
    try {
      await api.del(`/dm/threads/${username}`);
      await refetch();
      refetchDmUnread();
    } catch {
      /* ignore */
    }
  };
  const bulkClear = async () => {
    const ids = [...selected()];
    if (!ids.length) return;
    try {
      await api.post('/dm/threads/clear', { ids });
      setSelected(new Set<string>());
      setSelectMode(false);
      await refetch();
      refetchDmUnread();
    } catch {
      /* ignore */
    }
  };

  const onQuery = (v: string) => {
    setQuery(v);
    if (lookupTimer) clearTimeout(lookupTimer);
    const q = v.trim();
    if (q.length < 1) { setResults([]); return; }
    lookupTimer = setTimeout(async () => {
      try {
        const r = await api.get<UserBrief[]>(`/users/lookup?prefix=${encodeURIComponent(q)}`);
        setResults(r.filter((u) => u.username !== me()?.username));
      } catch { setResults([]); }
    }, 150);
  };
  const openCompose = () => { setComposing((v) => !v); setQuery(''); setResults([]); };

  const totalUnread = createMemo(() => (list() ?? []).reduce((n, x) => n + x.unread_count, 0));
  const filtered = createMemo(() => {
    const rows = list() ?? [];
    const f = filter().trim().toLowerCase();
    if (!f) return rows;
    return rows.filter(
      (x) => x.other_display_name.toLowerCase().includes(f) || x.other_username.toLowerCase().includes(f),
    );
  });

  const onNotif = (ev: Event) => {
    const d = (ev as CustomEvent).detail as { kind?: string } | undefined;
    if (d?.kind === 'dm') refetch();
  };
  onMount(() => window.addEventListener('burncpu:notification', onNotif));
  onCleanup(() => {
    window.removeEventListener('burncpu:notification', onNotif);
    if (lookupTimer) clearTimeout(lookupTimer);
  });

  return (
    <>
      {/* Header */}
      <div class="flex items-center justify-between gap-3 mb-1">
        <h1 class="font-headline-lg text-[26px] md:text-[28px] font-semibold tracking-tight text-on-background flex items-center gap-2">
          {t('dm.title')}
          <Show when={totalUnread() > 0}>
            <span class="text-[12px] font-mono font-bold bg-primary text-on-primary rounded-full px-2 py-0.5 leading-none">
              {totalUnread()}
            </span>
          </Show>
        </h1>
        <Show when={me()}>
          <div class="flex items-center gap-2">
            <Show when={selectMode()}>
              <button
                onClick={bulkClear}
                disabled={selected().size === 0}
                class="flex items-center gap-1 px-3 py-2 rounded-lg bg-error/15 text-error font-bold font-mono text-[13px] hover:bg-error/25 transition-colors disabled:opacity-40"
              >
                <span class="material-symbols-outlined" style="font-size:18px;">delete</span>
                {t('dm.delete_selected')}{selected().size > 0 ? ` (${selected().size})` : ''}
              </button>
            </Show>
            <Show when={(list()?.length ?? 0) > 0}>
              <button
                onClick={() => { setSelectMode((v) => !v); setSelected(new Set<string>()); }}
                class="flex items-center gap-1 px-3 py-2 rounded-lg border border-outline-variant text-on-surface-variant font-mono text-[13px] hover:text-primary hover:border-primary/50 transition-colors"
              >
                <span class="material-symbols-outlined" style="font-size:18px;">{selectMode() ? 'close' : 'checklist'}</span>
                {selectMode() ? t('common.cancel') : t('dm.select')}
              </button>
            </Show>
            <Show when={!selectMode()}>
              <button onClick={openCompose} class={NEW_BTN}>
                <span class="material-symbols-outlined" style="font-size:18px;">
                  {composing() ? 'close' : 'edit_square'}
                </span>
                {composing() ? t('common.cancel') : t('dm.new')}
              </button>
            </Show>
          </div>
        </Show>
      </div>
      <p class="text-on-surface-variant font-mono text-[12px] mb-5">{t('dm.mutual_required')}</p>

      <Show
        when={me()}
        fallback={<AuthGate icon="mail" title={t('auth.gate.dms')} />}
      >
        {/* New-message composer */}
        <Show when={composing()}>
          <div class="mb-5 p-4 bg-surface-container-low border border-outline-variant rounded-xl">
            <div class="relative">
              <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" style="font-size:18px;">
                search
              </span>
              <input
                type="text"
                placeholder={t('dm.search_user')}
                value={query()}
                onInput={(e) => onQuery(e.currentTarget.value)}
                autofocus
                class="w-full bg-surface-container border border-outline-variant pl-10 pr-3 py-2.5 rounded-lg font-mono text-[14px] text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:border-primary transition-colors"
              />
            </div>
            <Show when={results().length > 0}>
              <div class="mt-2 space-y-1">
                <For each={results()}>
                  {(u) => (
                    <button
                      onClick={() => navigate(`/dm/${u.username}`)}
                      class="flex items-center gap-3 w-full p-2.5 rounded-lg hover:bg-surface-container-high text-left transition-colors group"
                    >
                      <Avatar url={u.avatar_url} size="w-9 h-9" />
                      <div class="min-w-0">
                        <div class="font-semibold text-on-background truncate text-[14px]">{u.display_name}</div>
                        <div class="text-on-surface-variant font-mono text-[12px] truncate">@{u.username}</div>
                      </div>
                      <span class="material-symbols-outlined ml-auto text-on-surface-variant group-hover:text-primary transition-colors" style="font-size:18px;">
                        arrow_forward
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={query().trim().length > 0 && results().length === 0}>
              <p class="text-on-surface-variant text-[13px] mt-3">{t('dm.no_user')}</p>
            </Show>
          </div>
        </Show>

        {/* Conversation filter (only when there are several) */}
        <Show when={(list()?.length ?? 0) > 4}>
          <div class="relative mb-3">
            <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" style="font-size:18px;">
              filter_list
            </span>
            <input
              type="text"
              placeholder={t('dm.filter')}
              value={filter()}
              onInput={(e) => setFilter(e.currentTarget.value)}
              class="w-full bg-surface-container-low border border-outline-variant pl-10 pr-3 py-2 rounded-lg font-mono text-[13px] focus:outline-none focus:border-primary transition-colors"
            />
          </div>
        </Show>

        {/* Thread list */}
        <Show
          when={list()}
          fallback={
            <RowSkeletonList count={6} />
          }
        >
          <Show
            when={(list()?.length ?? 0) > 0}
            fallback={
              <div class="flex flex-col items-center justify-center text-center py-16 px-6">
                <div class="w-16 h-16 rounded-2xl bg-surface-container-low border border-outline-variant flex items-center justify-center text-[30px] mb-4">💬</div>
                <p class="text-on-surface-variant font-mono text-[14px] mb-4 max-w-[280px]">{t('dm.empty')}</p>
                <button onClick={() => setComposing(true)} class={NEW_BTN}>
                  <span class="material-symbols-outlined" style="font-size:18px;">edit_square</span>
                  {t('dm.new')}
                </button>
              </div>
            }
          >
            <div class="space-y-1">
              <For each={filtered()} fallback={<p class="text-on-surface-variant text-[13px] py-4">{t('dm.no_match')}</p>}>
                {(th) => {
                  const mine = () => th.last_sender_id === me()?.user_id;
                  const unread = () => th.unread_count > 0;
                  const sel = () => selected().has(th.id);
                  const Inner = () => (
                    <>
                      <Show when={selectMode()}>
                        <span class={`material-symbols-outlined shrink-0 ${sel() ? 'text-primary' : 'text-on-surface-variant/50'}`} style="font-size:22px;">
                          {sel() ? 'check_box' : 'check_box_outline_blank'}
                        </span>
                      </Show>
                      <Avatar url={th.other_avatar_url} />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <span class={`truncate text-on-background ${unread() ? 'font-bold' : 'font-semibold'}`}>
                            {th.other_display_name}
                          </span>
                          <span class="text-on-surface-variant font-mono text-[12px] truncate hidden sm:inline">
                            @{th.other_username}
                          </span>
                          <span class="ml-auto shrink-0 text-on-surface-variant font-mono text-[11px]">
                            {relTime(th.last_message_at)}
                          </span>
                        </div>
                        <div class="flex items-center gap-2 mt-0.5">
                          <span class={`flex-1 truncate text-[13px] ${unread() ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                            <Show when={mine()}>
                              <span class="text-on-surface-variant">{t('dm.you')}: </span>
                            </Show>
                            {th.last_body ?? '—'}
                          </span>
                          <Show when={unread()}>
                            <span class="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-on-primary text-[11px] font-bold flex items-center justify-center leading-none">
                              {th.unread_count}
                            </span>
                          </Show>
                        </div>
                      </div>
                    </>
                  );
                  return (
                    <div class="relative group">
                      <Show
                        when={selectMode()}
                        fallback={
                          <A href={`/dm/${th.other_username}`} class="flex items-center gap-3 p-3 pr-12 rounded-xl border border-transparent hover:bg-surface-container-low hover:border-outline-variant transition-colors">
                            <Inner />
                          </A>
                        }
                      >
                        <button onClick={() => toggleSel(th.id)} class="w-full flex items-center gap-3 p-3 rounded-xl border border-transparent hover:bg-surface-container-low text-left transition-colors">
                          <Inner />
                        </button>
                      </Show>
                      <Show when={!selectMode()}>
                        <button
                          onClick={(e) => deleteThread(th.other_username, e)}
                          title={t('dm.delete_conv')}
                          class="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-surface-container text-on-surface-variant hover:text-error transition-all"
                        >
                          <span class="material-symbols-outlined" style="font-size:18px;">delete</span>
                        </button>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </>
  );
}
