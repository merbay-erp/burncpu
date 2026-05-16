import { createSignal, Show, For } from 'solid-js';
import { api, type PostView } from '../api';
import { visibleLength } from '../util';

const MAX = 5000;

interface MediaResp {
  id: string;
  url: string;
  width?: number;
  height?: number;
}

interface UserBrief {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
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
  const [mentions, setMentions] = createSignal<UserBrief[]>([]);
  const [mentionIdx, setMentionIdx] = createSignal(0);
  let textarea: HTMLTextAreaElement | undefined;
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
      setMentions([]);
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
      const snippet = `\n\n![](${m.url})`;
      setBody((cur) => cur + snippet);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput) fileInput.value = '';
    }
  };

  let lookupTimer: ReturnType<typeof setTimeout> | undefined;

  // Detect "@partial" before the caret. Return the partial string or null.
  const currentMentionToken = (): string | null => {
    if (!textarea) return null;
    const pos = textarea.selectionStart ?? body().length;
    const upto = body().slice(0, pos);
    const m = /(^|[\s.,!?(\[])@([a-z0-9_]{0,32})$/i.exec(upto);
    return m ? m[2] : null;
  };

  const onInput = (e: InputEvent) => {
    setBody((e.currentTarget as HTMLTextAreaElement).value);
    const token = currentMentionToken();
    if (lookupTimer) clearTimeout(lookupTimer);
    if (token == null) {
      setMentions([]);
      return;
    }
    if (token.length === 0) {
      setMentions([]);
      return;
    }
    lookupTimer = setTimeout(async () => {
      try {
        const res = await api.get<UserBrief[]>(`/users/lookup?prefix=${encodeURIComponent(token)}`);
        setMentions(res);
        setMentionIdx(0);
      } catch {
        setMentions([]);
      }
    }, 150);
  };

  const insertMention = (username: string) => {
    if (!textarea) return;
    const pos = textarea.selectionStart ?? body().length;
    const before = body().slice(0, pos);
    const after = body().slice(pos);
    const newBefore = before.replace(/@([a-z0-9_]{0,32})$/i, `@${username} `);
    const next = newBefore + after;
    setBody(next);
    setMentions([]);
    setTimeout(() => {
      if (!textarea) return;
      const newPos = newBefore.length;
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (mentions().length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIdx((i) => Math.min(i + 1, mentions().length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const m = mentions()[mentionIdx()];
        if (m) {
          e.preventDefault();
          insertMention(m.username);
          return;
        }
      }
      if (e.key === 'Escape') {
        setMentions([]);
        return;
      }
    }
  };

  return (
    <div class="compose" style="position: relative;">
      <textarea
        ref={textarea}
        placeholder={props.placeholder ?? 'Ne düşünüyorsun?'}
        value={body()}
        onInput={onInput}
        onKeyDown={onKeyDown}
        disabled={busy()}
      />
      <Show when={mentions().length > 0}>
        <div
          style="position: absolute; left: 12px; right: 12px; top: 60px; background: var(--bg-3); border: 1px solid var(--border); border-radius: var(--radius); max-height: 200px; overflow-y: auto; z-index: 5;"
        >
          <For each={mentions()}>
            {(m, i) => (
              <div
                onMouseDown={(e) => { e.preventDefault(); insertMention(m.username); }}
                onMouseEnter={() => setMentionIdx(i())}
                style={`padding: 6px 10px; cursor: pointer; background: ${i() === mentionIdx() ? 'var(--bg-2)' : 'transparent'}; font-size: 13px;`}
              >
                <strong>@{m.username}</strong>
                <span class="muted" style="margin-left: 6px;">{m.display_name}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
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
