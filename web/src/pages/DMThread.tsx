import { createResource, createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js';
import { useParams, A } from '@solidjs/router';
import { api } from '../api';
import { me } from '../auth';
import { relTime } from '../util';
import { t } from '../i18n';

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

  // Mark read whenever we open OR switch threads. @solidjs/router reuses the
  // same component instance across /dm/alice → /dm/bob, so an onMount one-shot
  // would only ever mark the first thread read (the new thread's badge would
  // stay stuck). A createEffect on params.username re-fires on every switch.
  createEffect(() => {
    const u = params.username;
    if (me() && u) void api.patch(`/dm/threads/${u}/read`).catch(() => {});
  });

  onMount(() => {
    // 19 May 2026 — Real-time: thread acikken yeni mesaj geldiginde otomatik
    // refetch + read mark. Onceden sadece ↻ butonuna basinca yeni mesaj
    // geliyordu, kullanici "mesaj akmiyor" zannediyordu.
    const onNotif = (ev: Event) => {
      const d = (ev as CustomEvent).detail as { kind?: string; actor_username?: string } | undefined;
      if (d?.kind === 'dm' && d.actor_username === params.username) {
        refetch();
        void api.patch(`/dm/threads/${params.username}/read`).catch(() => {});
      }
    };
    window.addEventListener('burncpu:notification', onNotif);
    onCleanup(() => window.removeEventListener('burncpu:notification', onNotif));
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
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="legacy">
      <Show when={me()} fallback={<p class="muted">{t('dmthread.login_prefix')} <A href="/login">{t('nav.login_action')}</A>.</p>}>
        <Show when={data() as ThreadView | null | undefined} fallback={<p class="muted">{t('loading')}</p>}>
          {(th) => (
            <>
              <h2 class="page-title">
                <A href={`/u/${th().other_username}`} style="color: inherit;">
                  {th().other_display_name}
                </A>
                <small>@{th().other_username}</small>
              </h2>
              <Show when={!th().mutual_follow}>
                <div class="error">
                  {t('dm.mutual_required')}
                </div>
              </Show>
              <div style="margin: 12px 0;">
                <For
                  each={th().messages}
                  fallback={<div class="muted">{t('dmthread.empty')}</div>}
                >
                  {(m) => {
                    const mine = m.sender_id === me()?.user_id;
                    return (
                      <div
                        style={`display: flex; margin: 6px 0; ${mine ? 'justify-content: flex-end;' : ''}`}
                      >
                        <div
                          style={`max-width: 70%; padding: 8px 12px; border-radius: 12px; background: ${mine ? 'var(--accent)' : 'var(--bg-3)'}; color: ${mine ? '#1a0a00' : 'var(--fg)'};`}
                        >
                          <div innerHTML={m.body_html} />
                          <div
                            style={`font-size: 10px; opacity: 0.7; margin-top: 2px; text-align: right; font-family: var(--mono);`}
                          >
                            {relTime(m.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
              {/* 19 May 2026 — UX fix: kullanici onceden sadece "mutual_required" banner
                  goruyordu, hicbir CTA yoktu → "mesajlasma aktif olmuyor" sikayeti.
                  Simdi mutual=false ise: cift takipte aktif olur, takip et butonu CTA.
                  Optimistic: butona basinca local state hemen guncellenir + refetch. */}
              <Show when={th().mutual_follow} fallback={
                <div style="border-top: 1px solid var(--border); padding: 16px; text-align: center;">
                  <p class="muted" style="margin-bottom: 12px;">
                    {t('dmthread.mutual_cta_prefix')} <strong>{t('dmthread.mutual_cta_strong')}</strong> {t('dmthread.mutual_cta_suffix')}
                  </p>
                  <Show when={!th().is_following} fallback={
                    <p class="tiny muted">
                      {t('dmthread.pending_prefix')} @{th().other_username}{t('dmthread.pending_mid')} <strong>{t('dmthread.pending_strong')}</strong> {t('dmthread.pending_suffix')}
                    </p>
                  }>
                    <button
                      class="primary"
                      disabled={busy()}
                      onClick={async () => {
                        if (busy()) return;
                        setBusy(true);
                        try {
                          await api.post(`/users/${th().other_username}/follow`);
                          await refetch();
                        } catch (e) {
                          setErr((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {busy() ? t('compose.sending') : `@${th().other_username}${t('dmthread.follow_cta')}`}
                    </button>
                  </Show>
                </div>
              }>
                <div style="border-top: 1px solid var(--border); padding-top: 12px; position: sticky; bottom: 0; background: var(--bg);">
                  <textarea
                    placeholder={t('dmthread.message_placeholder')}
                    value={body()}
                    onInput={(e) => setBody(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        void send();
                      }
                    }}
                    rows="2"
                  />
                  <Show when={err()}>
                    <div class="error">{err()}</div>
                  </Show>
                  <div class="compose-actions">
                    <span class="tiny muted">{t('dmthread.send_hint')}</span>
                    <button class="primary" onClick={send} disabled={busy() || !body().trim()}>
                      {busy() ? t('compose.sending') : t('compose.send')}
                    </button>
                  </div>
                </div>
              </Show>
            </>
          )}
        </Show>
      </Show>
      <button class="ghost tiny" onClick={refetch} style="margin-top: 10px;">↻ {t('dmthread.refresh')}</button>
    </div>
  );
}
