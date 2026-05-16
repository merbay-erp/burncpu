import { createSignal, Show } from 'solid-js';
import { api, type PostView } from '../api';
import { visibleLength } from '../util';

const MAX = 5000;

export default function Compose(props: {
  replyToId?: string;
  placeholder?: string;
  onPosted?: (p: PostView) => void;
}) {
  const [body, setBody] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  const submit = async () => {
    const text = body().trim();
    if (!text) return;
    setBusy(true);
    setErr(null);
    try {
      const p = await api.post<PostView>('/posts', {
        body: text,
        reply_to_id: props.replyToId ?? null,
      });
      setBody('');
      props.onPosted?.(p);
    } catch (e) {
      setErr((e as Error).message || 'gönderim hatası');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="compose">
      <textarea
        placeholder={props.placeholder ?? 'Ne düşünüyorsun?'}
        value={body()}
        onInput={(e) => setBody(e.currentTarget.value)}
        disabled={busy()}
      />
      <Show when={err()}>
        <div class="error">{err()}</div>
      </Show>
      <div class="compose-actions">
        <span
          class={`char-count ${
            visibleLength(body()) > MAX ? 'bad' : visibleLength(body()) > MAX * 0.9 ? 'warn' : ''
          }`}
        >
          {visibleLength(body())} / {MAX}
        </span>
        <button
          class="primary"
          onClick={submit}
          disabled={busy() || !body().trim() || visibleLength(body()) > MAX}
        >
          {busy() ? 'Gönderiliyor...' : props.replyToId ? 'Yanıtla' : 'Gönder'}
        </button>
      </div>
    </div>
  );
}
