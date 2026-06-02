import { createResource, createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js';
import { useParams, A } from '@solidjs/router';
import { api } from '../api';
import { me } from '../auth';
import { relTime } from '../util';
import { t } from '../i18n';
import Avatar from '../components/Avatar';

interface DmMessage {
  id: string;
  sender_id: string;
  body: string;
  body_html: string;
  read_at: string | null;
  created_at: string;
}

interface ThreadView {
  id: string | null;
  other_username: string;
  other_display_name: string;
  other_avatar_url: string | null;
  mutual_follow: boolean;
  is_following: boolean;
  is_followed_by: boolean;
  messages: DmMessage[];
  next_before: string | null;
}

export default function DMThread() {
  const params = useParams<{ username: string }>();
  const [data, { refetch, mutate }] = createResource<ThreadView | null, string>(
    () => params.username,
    async (u: string) => {
      if (!me()) return null;
      return api.get<ThreadView>(`/dm/threads/${u}`);
    },
  );
  const [body, setBody] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  let bottomRef: HTMLDivElement | undefined;
  const [otherTyping, setOtherTyping] = createSignal(false);
  let typingClearTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTypingSent = 0;

  const scrollToBottom = () => setTimeout(() => bottomRef?.scrollIntoView({ block: 'end' }), 40);

  // Tell the other side we're typing — throttled so a fast typist sends at most
  // one ping every 2.5s (the backend also throttles).
  const pingTyping = () => {
    const now = Date.now();
    if (now - lastTypingSent < 2500) return;
    lastTypingSent = now;
    void api.post(`/dm/threads/${params.username}/typing`).catch(() => {});
  };

  // Mark read whenever we open OR switch threads. The router reuses the
  // component instance across /dm/alice → /dm/bob, so a createEffect on
  // params.username re-fires on every switch (an onMount one-shot wouldn't).
  createEffect(() => {
    const u = params.username;
    if (me() && u) void api.patch(`/dm/threads/${u}/read`).catch(() => {});
  });

  // Scroll to the newest message once the thread (or a new message) loads.
  createEffect(() => {
    if ((data()?.messages?.length ?? 0) > 0) scrollToBottom();
  });

  onMount(() => {
    // Real-time: when a DM arrives for the open thread, refetch + mark read.
    const onNotif = (ev: Event) => {
      const d = (ev as CustomEvent).detail as { kind?: string; actor_username?: string } | undefined;
      if (d?.kind === 'dm' && d.actor_username === params.username) {
        refetch();
        void api.patch(`/dm/threads/${params.username}/read`).catch(() => {});
      }
    };
    window.addEventListener('burncpu:notification', onNotif);
    onCleanup(() => window.removeEventListener('burncpu:notification', onNotif));

    // The other person is typing → show the indicator, auto-clear after a gap.
    const onTyping = (ev: Event) => {
      const d = (ev as CustomEvent).detail as { actor_username?: string } | undefined;
      if (d?.actor_username === params.username) {
        setOtherTyping(true);
        scrollToBottom();
        if (typingClearTimer) clearTimeout(typingClearTimer);
        typingClearTimer = setTimeout(() => setOtherTyping(false), 4000);
      }
    };
    window.addEventListener('burncpu:typing', onTyping);
    onCleanup(() => window.removeEventListener('burncpu:typing', onTyping));
  });

  const send = async () => {
    const text = body().trim();
    if (!text || busy()) return;
    setBusy(true);
    setErr(null);
    try {
      const msg = await api.post<DmMessage>(`/dm/threads/${params.username}`, { body: text });
      const cur = data() as ThreadView | null | undefined;
      if (cur) mutate({ ...cur, messages: [...cur.messages, msg] });
      setBody('');
      scrollToBottom();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doFollow = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await api.post(`/users/${params.username}/follow`);
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Show
        when={me()}
        fallback={
          <p class="text-on-surface-variant text-[14px]">
            {t('dmthread.login_prefix')} <A href="/login" class="text-primary hover:underline">{t('nav.login_action')}</A>.
          </p>
        }
      >
        <Show when={data() as ThreadView | null | undefined} fallback={<div class="p-6 text-on-surface-variant font-mono text-center text-[14px]">{t('loading')}</div>}>
          {(th) => (
            <div class="flex flex-col min-h-[calc(100vh-8rem)]">
              {/* Header */}
              <header class="sticky top-16 z-10 py-3 mb-2 flex items-center gap-3 bg-background/95 backdrop-blur-md border-b border-outline-variant">
                <A href="/dm" class="lg:hidden p-1.5 -ml-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors">
                  <span class="material-symbols-outlined">arrow_back</span>
                </A>
                <A href={`/u/${th().other_username}`} class="group flex items-center gap-3 min-w-0 flex-1">
                  <Avatar url={th().other_avatar_url} name={th().other_display_name} size={40} class="rounded-xl ring-1 ring-outline-variant/60" />
                  <div class="min-w-0">
                    <div class="font-bold text-on-background truncate group-hover:underline decoration-primary/50 decoration-2 underline-offset-2">{th().other_display_name}</div>
                    <div class="font-mono text-[12px] text-on-surface-variant truncate">@{th().other_username}</div>
                  </div>
                </A>
                <button onClick={refetch} title={t('dmthread.refresh')} class="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors">
                  <span class="material-symbols-outlined" style="font-size:20px;">refresh</span>
                </button>
              </header>

              {/* Messages */}
              <div class="flex-1 flex flex-col gap-1.5 py-4">
                <For
                  each={th().messages}
                  fallback={
                    <div class="flex-1 flex flex-col items-center justify-center text-center py-12 gap-2">
                      <span class="material-symbols-outlined text-on-surface-variant/50" style="font-size:40px;">forum</span>
                      <p class="text-on-surface-variant font-mono text-[13px]">{t('dmthread.empty')}</p>
                    </div>
                  }
                >
                  {(m) => {
                    const mine = m.sender_id === me()?.user_id;
                    return (
                      <div class={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          class={`max-w-[80%] px-3.5 py-2 rounded-2xl text-[14px] leading-relaxed break-words shadow-sm ${
                            mine
                              ? 'bg-primary text-on-primary rounded-br-sm'
                              : 'bg-surface-container text-on-surface rounded-bl-sm'
                          }`}
                        >
                          <div class="dm-body" innerHTML={m.body_html} />
                          <div class={`text-[10px] font-mono mt-1 text-right ${mine ? 'text-on-primary/70' : 'text-on-surface-variant/70'}`}>
                            {relTime(m.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
                <Show when={otherTyping()}>
                  <div class="flex justify-start">
                    <div class="bg-surface-container rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                      <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
                    </div>
                  </div>
                </Show>
                <div ref={bottomRef}></div>
              </div>

              {/* Composer or mutual-follow CTA */}
              <Show
                when={th().mutual_follow}
                fallback={
                  <div class="mt-2 p-6 rounded-2xl border border-dashed border-outline-variant text-center">
                    <span class="material-symbols-outlined text-on-surface-variant/60" style="font-size:32px;">lock</span>
                    <p class="text-on-surface-variant text-[14px] mt-2">
                      {t('dmthread.mutual_cta_prefix')} <strong class="text-on-background">{t('dmthread.mutual_cta_strong')}</strong> {t('dmthread.mutual_cta_suffix')}
                    </p>
                    <Show
                      when={!th().is_following}
                      fallback={
                        <p class="text-on-surface-variant/80 text-[12px] font-mono mt-3">
                          {t('dmthread.pending_prefix')} @{th().other_username}{t('dmthread.pending_mid')} <strong>{t('dmthread.pending_strong')}</strong> {t('dmthread.pending_suffix')}
                        </p>
                      }
                    >
                      <button
                        disabled={busy()}
                        onClick={doFollow}
                        class="mt-4 px-5 py-2 rounded-lg bg-primary text-on-primary font-bold font-mono text-[13px] hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                      >
                        {busy() ? t('compose.sending') : `@${th().other_username}${t('dmthread.follow_cta')}`}
                      </button>
                    </Show>
                  </div>
                }
              >
                <div class="sticky bottom-16 lg:bottom-0 pt-3 pb-3 bg-background border-t border-outline-variant">
                  <Show when={err()}><div class="error mb-2">{err()}</div></Show>
                  <div class="flex items-end gap-2 bg-surface-container border border-outline-variant rounded-2xl p-2 focus-within:border-primary/40 transition-colors">
                    <textarea
                      placeholder={t('dmthread.message_placeholder')}
                      value={body()}
                      onInput={(e) => { setBody(e.currentTarget.value); pingTyping(); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
                      }}
                      rows={1}
                      class="flex-1 bg-transparent border-none focus:ring-0 resize-none min-h-0 h-10 py-2 px-2 text-on-surface placeholder:text-on-surface-variant/50 text-[14px] font-sans"
                    />
                    <button
                      onClick={send}
                      disabled={busy() || !body().trim()}
                      title={t('compose.send')}
                      class="shrink-0 w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center hover:opacity-90 active:scale-90 transition-all disabled:opacity-40"
                    >
                      <span class="material-symbols-outlined" style="font-size:19px;">send</span>
                    </button>
                  </div>
                  <div class="text-[10px] font-mono text-on-surface-variant/60 mt-1.5 px-1">{t('dmthread.send_hint')}</div>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}
