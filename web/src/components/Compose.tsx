import { createSignal, Show } from 'solid-js';
import { api, type PostView } from '../api';
import { visibleLength } from '../util';

const MAX = 5000;

interface MediaResp {
  id: string;
  url: string;
  width?: number;
  height?: number;
}

export default function Compose(props: {
  replyToId?: string;
  placeholder?: string;
  onPosted?: (p: PostView) => void;
}) {
  const [body, setBody] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  let fileInput: HTMLInputElement | undefined;

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

  const pickFile = () => fileInput?.click();

  const upload = async (e: Event) => {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
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
      const m = (await r.json()) as MediaResp;
      // Inject markdown image at cursor end
      const snippet = `\n\n![](${m.url})`;
      setBody((cur) => cur + snippet);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput) fileInput.value = '';
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
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style="display: none;"
        onChange={upload}
      />
      <Show when={err()}>
        <div class="error">{err()}</div>
      </Show>
      <div class="compose-actions">
        <button class="ghost tiny" onClick={pickFile} disabled={uploading() || busy()}>
          {uploading() ? 'Yükleniyor…' : '📎 Görsel ekle'}
        </button>
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
