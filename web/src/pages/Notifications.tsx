import { createSignal, createEffect, For, Show, onMount, onCleanup, type JSX } from 'solid-js';
import { A } from '@solidjs/router';
import AuthGate from '../components/AuthGate';
import { api, type Notification } from '../api';
import { me, refetchUnread } from '../auth';
import { relTime } from '../util';
import { t } from '../i18n';
import InfiniteList from '../components/InfiniteList';
import { RowSkeletonList } from '../components/Skeleton';

interface Listing {
  notifications: Notification[];
  next_before: string | null;
}

const KIND_ICON: Record<string, string> = {
  reaction: 'favorite',
  reply: 'reply',
  follow: 'person_add',
  mention: 'alternate_email',
  mod_action: 'gavel',
};
const kindIcon = (k: string) => KIND_ICON[k] ?? 'notifications';

function Avatar(props: { url: string | null }) {
  return (
    <div class="w-11 h-11 rounded-xl bg-surface-container-highest flex items-center justify-center text-[20px] text-primary overflow-hidden shrink-0 border border-outline-variant/40">
      <Show when={props.url} fallback={<>🐢</>}>
        <img src={props.url!} alt="" class="w-full h-full object-cover" />
      </Show>
    </div>
  );
}

function bodyText(n: Notification): JSX.Element {
  const who = n.actor_username ?? 'biri';
  const handle = <strong class="font-semibold text-on-background">@{who}</strong>;
  switch (n.kind) {
    case 'reaction': {
      const emoji =
        n.metadata && typeof n.metadata['emoji'] === 'string' ? (n.metadata['emoji'] as string) : '';
      return <>{handle} {t('notif.reacted')} {emoji}</>;
    }
    case 'reply':
      return <>{handle} {t('notif.replied')}</>;
    case 'follow':
      return <>{handle} {t('notif.followed')}</>;
    case 'mention':
      return <>{handle} {t('notif.mentioned')}</>;
    case 'mod_action':
      return <>{t('notif.mod')}</>;
  }
}

const linkFor = (n: Notification): string => {
  if (n.target_kind === 'post') return `/posts/${n.target_id}`;
  if (n.target_kind === 'user' && n.actor_username) return `/u/${n.actor_username}`;
  return '/';
};

export default function NotificationsPage() {
  const [items, setItems] = createSignal<Notification[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [tab, setTab] = createSignal<'all' | 'unread'>('all');
  let started = false;

  const loadMore = async () => {
    if (!me() || loading() || done()) return;
    setLoading(true);
    try {
      const qs = cursor() ? `?limit=30&before=${encodeURIComponent(cursor()!)}` : '?limit=30';
      const page = await api.get<Listing>(`/notifications${qs}`);
      setItems((cur) => [...cur, ...page.notifications]);
      if (page.next_before && page.notifications.length > 0) setCursor(page.next_before);
      else setDone(true);
    } finally {
      setLoading(false);
    }
  };
  const reload = () => {
    setItems([]);
    setCursor(null);
    setDone(false);
    started = true;
    loadMore();
  };

  // Initial load once the session is known; SSE pushes reload from the top.
  createEffect(() => {
    if (me() && !started) {
      started = true;
      loadMore();
    }
  });
  onMount(() => {
    const onNotif = () => reload();
    window.addEventListener('burncpu:notification', onNotif);
    onCleanup(() => window.removeEventListener('burncpu:notification', onNotif));
  });

  const unreadCount = () => items().filter((n) => !n.read_at).length;
  const shown = () => (tab() === 'unread' ? items().filter((n) => !n.read_at) : items());

  const markAll = async () => {
    try { await api.patch('/notifications/read'); } catch { /* ignore */ }
    setItems((cur) => cur.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    refetchUnread();
  };
  const markRead = (n: Notification) => {
    if (n.read_at) return;
    api.patch(`/notifications/${n.id}/read`).catch(() => {});
    setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    refetchUnread();
  };

  return (
    <Show
      when={me()}
      fallback={<AuthGate icon="notifications" title={t('auth.gate.notifications')} />}
    >
      {/* Header */}
      <div class="flex items-center justify-between gap-3 mb-3">
        <h1 class="font-headline-lg text-[26px] md:text-[28px] font-semibold tracking-tight text-on-background flex items-center gap-2">
          {t('notif.title')}
          <Show when={unreadCount() > 0}>
            <span class="text-[12px] font-mono font-bold bg-primary text-on-primary rounded-full px-2 py-0.5 leading-none">
              {unreadCount()}
            </span>
          </Show>
        </h1>
        <Show when={unreadCount() > 0}>
          <button
            onClick={markAll}
            class="flex items-center gap-1.5 text-on-surface-variant hover:text-primary font-mono text-[12px] transition-colors"
          >
            <span class="material-symbols-outlined" style="font-size:16px;">done_all</span>
            {t('notif.mark_all')}
          </button>
        </Show>
      </div>

      {/* Tabs */}
      <div class="flex gap-1 mb-4 border-b border-outline-variant">
        <TabBtn label={t('notif.tab_all')} active={tab() === 'all'} onClick={() => setTab('all')} />
        <TabBtn
          label={`${t('notif.tab_unread')}${unreadCount() > 0 ? ` (${unreadCount()})` : ''}`}
          active={tab() === 'unread'}
          onClick={() => setTab('unread')}
        />
      </div>

      <Show
        when={!(loading() && items().length === 0)}
        fallback={<RowSkeletonList count={6} />}
      >
        <Show
          when={shown().length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center text-center py-16 px-6">
              <div class="w-16 h-16 rounded-2xl bg-surface-container-low border border-outline-variant flex items-center justify-center text-[28px] mb-4">🔔</div>
              <p class="text-on-surface-variant font-mono text-[14px]">
                {tab() === 'unread' ? t('notif.empty_unread') : t('notif.empty')}
              </p>
            </div>
          }
        >
          <InfiniteList onLoadMore={loadMore} loading={loading()} done={done() || tab() === 'unread'}>
            <div class="space-y-1">
              <For each={shown()}>
                {(n) => (
                  <A
                    href={linkFor(n)}
                    onClick={() => markRead(n)}
                    class={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                      n.read_at
                        ? 'border-transparent hover:bg-surface-container-low hover:border-outline-variant'
                        : 'bg-surface-container-low border-primary/30'
                    }`}
                  >
                    <div class="relative shrink-0">
                      <Avatar url={n.actor_avatar_url} />
                      <span
                        class={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-surface-container border-2 border-background flex items-center justify-center ${
                          n.kind === 'mod_action' ? 'text-error' : 'text-primary'
                        }`}
                      >
                        <span class="material-symbols-outlined" style="font-size:12px;">{kindIcon(n.kind)}</span>
                      </span>
                    </div>
                    <div class="flex-1 min-w-0 pt-0.5">
                      <div class="text-[14px] text-on-surface leading-snug">{bodyText(n)}</div>
                      <div class="text-on-surface-variant font-mono text-[11px] mt-1">{relTime(n.created_at)}</div>
                    </div>
                    <Show when={!n.read_at}>
                      <span class="w-2 h-2 rounded-full bg-primary shrink-0 mt-2"></span>
                    </Show>
                  </A>
                )}
              </For>
            </div>
          </InfiniteList>
        </Show>
      </Show>
    </Show>
  );
}

function TabBtn(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      class={`px-4 py-2 font-mono text-[13px] border-b-2 -mb-px transition-colors ${
        props.active
          ? 'border-primary text-primary font-bold'
          : 'border-transparent text-on-surface-variant hover:text-on-surface'
      }`}
    >
      {props.label}
    </button>
  );
}
