import { createResource, createSignal, For, Show, onMount } from 'solid-js';
import { useParams, A } from '@solidjs/router';
import { api } from '../api';
import { me } from '../auth';
import { relTime } from '../util';

interface DmMessage {
  id: string;
  sender_id: string;
  body: string;
  body_html: string;
  read_at: string | null;
  created_at: string;
}

interface ThreadView {
  id: string;
  other_username: string;
  other_display_name: string;
  mutual_follow: boolean;
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

  onMount(() => {
    // Mark read whenever we open the thread
    if (me()) {
      void api.patch(`/dm/threads/${params.username}/read`).catch(() => {});
    }
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
    <>
      <Show when={me()} fallback={<p class="muted">Önce <A href="/login">giriş yap</A>.</p>}>
        <Show when={data() as ThreadView | null | undefined} fallback={<p class="muted">Yükleniyor…</p>}>
          {(t) => (
            <>
              <h2 class="page-title">
                <A href={`/u/${t().other_username}`} style="color: inherit;">
                  {t().other_display_name}
                </A>
                <small>@{t().other_username}</small>
              </h2>
              <Show when={!t().mutual_follow}>
                <div class="error">
                  DM atabilmek için iki tarafın da birbirini takip etmesi gerekiyor.
                </div>
              </Show>
              <div style="margin: 12px 0;">
                <For
                  each={t().messages}
                  fallback={<div class="muted">Henüz mesaj yok. İlki sen ol.</div>}
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
              <Show when={t().mutual_follow}>
                <div style="border-top: 1px solid var(--border); padding-top: 12px; position: sticky; bottom: 0; background: var(--bg);">
                  <textarea
                    placeholder="Mesajın..."
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
                    <span class="tiny muted">⌘/Ctrl + Enter ile gönder</span>
                    <button class="primary" onClick={send} disabled={busy() || !body().trim()}>
                      {busy() ? 'Gönderiliyor…' : 'Gönder'}
                    </button>
                  </div>
                </div>
              </Show>
            </>
          )}
        </Show>
      </Show>
      <button class="ghost tiny" onClick={refetch} style="margin-top: 10px;">↻ yenile</button>
    </>
  );
}
