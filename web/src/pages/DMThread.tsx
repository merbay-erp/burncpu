import { createResource, createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js';
import { useParams, A } from '@solidjs/router';
import AuthGate from '../components/AuthGate';
import { api } from '../api';
import { me, refetchDmUnread } from '../auth';
import { relTime } from '../util';
import { t } from '../i18n';
import Avatar from '../components/Avatar';

interface DmReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

interface DmMessage {
  id: string;
  sender_id: string;
  body: string;
  body_html: string;
  media_url: string | null;
  media_kind: string | null;
  reactions?: DmReaction[];
  read_at: string | null;
  created_at: string;
}

const DM_EMOJI = ['🔥', '🐢', '🤝', '🙏', '😂'];
const absTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

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
  const [pendingMedia, setPendingMedia] = createSignal<{ url: string; kind: 'image' | 'video' } | null>(null);
  const [uploading, setUploading] = createSignal(false);
  const [reactFor, setReactFor] = createSignal<string | null>(null);
  let fileInput: HTMLInputElement | undefined;

  const scrollToBottom = () => setTimeout(() => bottomRef?.scrollIntoView({ block: 'end' }), 40);

  // Subtle in-app "new message" chime via Web Audio (no asset to ship).
  const playPing = () => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ac = new Ctx();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.connect(g);
      g.connect(ac.destination);
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, ac.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.25);
      o.start();
      o.stop(ac.currentTime + 0.26);
      o.onended = () => void ac.close();
    } catch {
      /* no audio device / no user gesture yet */
    }
  };

  const patchMessage = (id: string, fn: (m: DmMessage) => DmMessage) => {
    const cur = data() as ThreadView | null | undefined;
    if (cur) mutate({ ...cur, messages: cur.messages.map((m) => (m.id === id ? fn(m) : m)) });
  };

  // Toggle my reaction on a message (optimistic; one emoji per user).
  const toggleReact = async (m: DmMessage, emoji: string) => {
    setReactFor(null);
    const mineNow = m.reactions?.find((r) => r.mine);
    const removing = mineNow?.emoji === emoji;
    patchMessage(m.id, (msg) => {
      let rx = (msg.reactions ?? []).map((r) => ({ ...r }));
      if (mineNow) {
        rx = rx
          .map((r) => (r.emoji === mineNow.emoji ? { ...r, count: r.count - 1, mine: false } : r))
          .filter((r) => r.count > 0);
      }
      if (!removing) {
        const ex = rx.find((r) => r.emoji === emoji);
        if (ex) {
          ex.count += 1;
          ex.mine = true;
        } else {
          rx.push({ emoji, count: 1, mine: true });
        }
      }
      return { ...msg, reactions: rx };
    });
    try {
      if (removing) await api.del(`/dm/messages/${m.id}/react`);
      else await api.post(`/dm/messages/${m.id}/react`, { emoji });
    } catch {
      void refetch();
    }
  };

  // Attach an image (uploads through the same /media pipeline as posts).
  const onPickFile = async (e: Event) => {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (fileInput) fileInput.value = '';
    if (!f) return;
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch('/api/v1/media', {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? `HTTP ${r.status}`);
      }
      const m = (await r.json()) as { url: string };
      setPendingMedia({ url: m.url, kind: 'image' });
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const deleteMsg = async (id: string) => {
    const cur = data() as ThreadView | null | undefined;
    if (cur) mutate({ ...cur, messages: cur.messages.filter((m) => m.id !== id) });
    try {
      await api.del(`/dm/messages/${id}`);
      void refetchDmUnread();
    } catch {
      void refetch();
    }
  };

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
    if (me() && u) void api.patch(`/dm/threads/${u}/read`).then(() => refetchDmUnread()).catch(() => {});
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
        playPing();
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
    const media = pendingMedia();
    if ((!text && !media) || busy()) return;
    setBusy(true);
    setErr(null);
    try {
      const msg = await api.post<DmMessage>(`/dm/threads/${params.username}`, {
        body: text,
        media_url: media?.url,
        media_kind: media?.kind,
      });
      const cur = data() as ThreadView | null | undefined;
      if (cur) mutate({ ...cur, messages: [...cur.messages, msg] });
      setBody('');
      setPendingMedia(null);
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
        fallback={<AuthGate icon="mail" title={t('auth.gate.dms')} />}
      >
        <Show when={data() as ThreadView | null | undefined} fallback={<div class="p-6 text-on-surface-variant font-mono text-center text-[14px]">{t('loading')}</div>}>
          {(th) => (
            <div class="flex flex-col min-h-[calc(100vh-8rem)]">
              {/* Header */}
              <header class="sticky top-16 z-10 py-3 mb-2 flex items-center gap-3 bg-background/95 backdrop-blur-md border-b border-outline-variant">
                <A href="/dm" class="p-1.5 -ml-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors" title={t('postdetail.back')}>
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
                      <div class={`group flex items-end gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                        <Show when={mine}>
                          <button
                            onClick={() => deleteMsg(m.id)}
                            title={t('dmthread.delete')}
                            class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-on-surface-variant/60 hover:text-error"
                          >
                            <span class="material-symbols-outlined" style="font-size:16px;">delete</span>
                          </button>
                        </Show>
                        <div class="relative max-w-[80%]">
                          <div
                            class={`px-3.5 py-2 rounded-2xl text-[14px] leading-relaxed break-words shadow-sm ${
                              mine
                                ? 'bg-primary text-on-primary rounded-br-sm'
                                : 'bg-surface-container text-on-surface rounded-bl-sm'
                            }`}
                          >
                            <Show when={m.media_url}>
                              <Show
                                when={m.media_kind === 'video'}
                                fallback={<img src={m.media_url!} alt="" loading="lazy" class="rounded-lg max-h-72 w-auto mb-1" />}
                              >
                                <video src={m.media_url!} controls preload="metadata" class="rounded-lg max-h-72 w-auto mb-1" />
                              </Show>
                            </Show>
                            <Show when={m.body}>
                              <div class="dm-body" innerHTML={m.body_html} />
                            </Show>
                            <div class={`flex items-center gap-1 text-[10px] font-mono mt-1 justify-end ${mine ? 'text-on-primary/70' : 'text-on-surface-variant/70'}`}>
                              <span title={absTime(m.created_at)}>{relTime(m.created_at)}</span>
                              <Show when={mine}>
                                <span
                                  class="material-symbols-outlined"
                                  style="font-size:13px;"
                                  title={m.read_at ? t('dmthread.read') : t('dmthread.sent')}
                                >
                                  {m.read_at ? 'done_all' : 'done'}
                                </span>
                              </Show>
                            </div>
                          </div>
                          <Show when={(m.reactions?.length ?? 0) > 0}>
                            <div class={`flex flex-wrap gap-1 mt-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                              <For each={m.reactions}>
                                {(r) => (
                                  <button
                                    onClick={() => toggleReact(m, r.emoji)}
                                    class={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] border transition-colors ${
                                      r.mine ? 'border-primary/60 bg-primary/10' : 'border-outline-variant bg-surface-container hover:border-primary/40'
                                    }`}
                                  >
                                    <span>{r.emoji}</span>
                                    <span class="font-mono text-on-surface-variant">{r.count}</span>
                                  </button>
                                )}
                              </For>
                            </div>
                          </Show>
                          <Show when={reactFor() === m.id}>
                            <div class={`absolute z-20 -top-9 ${mine ? 'right-0' : 'left-0'} flex gap-0.5 bg-surface-container-high border border-outline-variant rounded-full px-1.5 py-1 shadow-lg`}>
                              <For each={DM_EMOJI}>
                                {(e) => (
                                  <button onClick={() => toggleReact(m, e)} class="text-[16px] hover:scale-125 transition-transform px-0.5">
                                    {e}
                                  </button>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                        <button
                          onClick={() => setReactFor(reactFor() === m.id ? null : m.id)}
                          title={t('post.react')}
                          class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-on-surface-variant/60 hover:text-primary"
                        >
                          <span class="material-symbols-outlined" style="font-size:16px;">add_reaction</span>
                        </button>
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
                  <Show when={pendingMedia()}>
                    {(pm) => (
                      <div class="mb-2 relative inline-block">
                        <img src={pm().url} alt="" class="rounded-lg max-h-32 w-auto border border-outline-variant" />
                        <button
                          onClick={() => setPendingMedia(null)}
                          title={t('common.remove')}
                          class="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-surface-container-high border border-outline-variant text-on-surface flex items-center justify-center hover:text-error"
                        >
                          <span class="material-symbols-outlined" style="font-size:15px;">close</span>
                        </button>
                      </div>
                    )}
                  </Show>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    class="hidden"
                    onChange={onPickFile}
                  />
                  <div class="flex items-end gap-2 bg-surface-container border border-outline-variant rounded-2xl p-2 focus-within:border-primary/40 transition-colors">
                    <button
                      onClick={() => fileInput?.click()}
                      disabled={uploading()}
                      title={t('compose.add_image')}
                      class="shrink-0 w-9 h-9 rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container-high flex items-center justify-center transition-colors disabled:opacity-40"
                    >
                      <span class="material-symbols-outlined" style="font-size:20px;">{uploading() ? 'hourglass_empty' : 'image'}</span>
                    </button>
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
                      disabled={busy() || (!body().trim() && !pendingMedia())}
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
