import { createSignal, createMemo, createEffect, Show, For, onMount } from 'solid-js';
import { api, type PostView } from '../api';
import { visibleLength, firstUrl } from '../util';
import { t } from '../i18n';
import EmojiPicker from './EmojiPicker';
import LinkCard from './LinkCard';
import Avatar from './Avatar';
import { me } from '../auth';

const MAX = 5000;
const DRAFT_KEY = 'burncpu.draft';

interface MediaResp { id: string; url: string; width?: number; height?: number; }
interface UserBrief { id: string; username: string; display_name: string; avatar_url: string | null; }

export default function Compose(props: {
  replyToId?: string;
  placeholder?: string;
  autofocus?: boolean;
  // Persist an unsent draft to localStorage (only the always-present timeline
  // composer opts in — not the FAB popup or inline reply boxes).
  persistDraft?: boolean;
  onPosted?: (p: PostView) => void;
}) {
  const readDraft = (): string => {
    if (!props.persistDraft) return '';
    try { return localStorage.getItem(DRAFT_KEY) ?? ''; } catch { return ''; }
  };
  // Initialize from the saved draft so the save-effect's first run never wipes
  // it (effect runs before onMount).
  const [body, setBody] = createSignal(readDraft());
  const [cw, setCw] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const [mentions, setMentions] = createSignal<UserBrief[]>([]);
  const [mentionIdx, setMentionIdx] = createSignal(0);
  // Live link preview: debounced URL the user has typed, plus a dismissal so an
  // unwanted card stays gone until the URL actually changes.
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);
  const [dismissedUrl, setDismissedUrl] = createSignal<string | null>(null);
  const livePreview = createMemo(() => {
    const u = previewUrl();
    return u && u !== dismissedUrl() ? u : null;
  });
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let textarea: HTMLTextAreaElement | undefined;
  let fileInput: HTMLInputElement | undefined;

  // When opened as an inline reply box, drop the cursor straight into the
  // textarea so the user can just start typing.
  // Draft persistence for the main composer (not inline replies): restore on
  // mount, auto-save as you type, clear once posted. So a refresh / accidental
  // navigation never eats a half-written signal.
  const isMainComposer = () => props.persistDraft === true;

  onMount(() => {
    if (props.autofocus && textarea) {
      // preventScroll: the inline reply box already opens right under the post,
      // so don't let focus() yank the page to re-center the textarea (it caused
      // a jarring scroll jump, especially on mobile).
      textarea.focus({ preventScroll: true });
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    }
  });

  createEffect(() => {
    const b = body();
    if (!isMainComposer()) return;
    try {
      if (b.trim()) localStorage.setItem(DRAFT_KEY, b);
      else localStorage.removeItem(DRAFT_KEY);
    } catch { /* ignore */ }
  });

  const submit = async () => {
    const text = body().trim();
    if (!text) return;
    setBusy(true); setErr(null);
    try {
      const p = await api.post<PostView>('/posts', {
        body: text,
        reply_to_id: props.replyToId ?? null,
        content_warning: cw().trim() || null,
      });
      setBody(''); setCw(''); setMentions([]);
      setPreviewUrl(null); setDismissedUrl(null);
      props.onPosted?.(p);
    } catch (e) { setErr((e as Error).message || t('compose.error')); }
    finally { setBusy(false); }
  };

  const pickFile = () => fileInput?.click();

  const upload = async (e: Event) => {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    setUploading(true); setErr(null);
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await fetch('/api/v1/media', {
        method: 'POST', body: fd, credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? `HTTP ${r.status}`);
      }
      const m = (await r.json()) as MediaResp;
      setBody((cur) => cur + `\n\n![](${m.url})`);
    } catch (e) { setErr((e as Error).message); }
    finally {
      setUploading(false);
      if (fileInput) fileInput.value = '';
    }
  };

  let lookupTimer: ReturnType<typeof setTimeout> | undefined;
  const currentMentionToken = (): string | null => {
    if (!textarea) return null;
    const pos = textarea.selectionStart ?? body().length;
    const upto = body().slice(0, pos);
    const m = /(^|[\s.,!?(\[])@([a-z0-9_]{0,32})$/i.exec(upto);
    return m ? m[2] : null;
  };

  const onInput = (e: InputEvent) => {
    setBody((e.currentTarget as HTMLTextAreaElement).value);
    // Debounce the unfurl so we don't fetch on every keystroke mid-URL.
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => setPreviewUrl(firstUrl(body())), 500);
    const token = currentMentionToken();
    if (lookupTimer) clearTimeout(lookupTimer);
    if (token == null || token.length === 0) { setMentions([]); return; }
    lookupTimer = setTimeout(async () => {
      try {
        const res = await api.get<UserBrief[]>(`/users/lookup?prefix=${encodeURIComponent(token)}`);
        setMentions(res); setMentionIdx(0);
      } catch { setMentions([]); }
    }, 150);
  };

  const insertMention = (username: string) => {
    if (!textarea) return;
    const pos = textarea.selectionStart ?? body().length;
    const before = body().slice(0, pos);
    const after = body().slice(pos);
    const newBefore = before.replace(/@([a-z0-9_]{0,32})$/i, `@${username} `);
    const next = newBefore + after;
    setBody(next); setMentions([]);
    setTimeout(() => {
      if (!textarea) return;
      const newPos = newBefore.length;
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const insertAtCursor = (s: string) => {
    if (!textarea) { setBody((cur) => cur + s); return; }
    const pos = textarea.selectionStart ?? body().length;
    const next = body().slice(0, pos) + s + body().slice(pos);
    setBody(next);
    setTimeout(() => {
      if (!textarea) return;
      const newPos = pos + s.length;
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  // Wrap the current selection (or insert markers at the caret) for markdown
  // formatting. Caret lands after the wrap when text was selected, otherwise
  // between the markers so you can just start typing.
  const wrapSelection = (before: string, after: string) => {
    if (!textarea) return;
    const start = textarea.selectionStart ?? body().length;
    const end = textarea.selectionEnd ?? start;
    const val = body();
    const selected = val.slice(start, end);
    const next = val.slice(0, start) + before + selected + after + val.slice(end);
    setBody(next);
    setTimeout(() => {
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      const caret = selected
        ? start + before.length + selected.length + after.length
        : start + before.length;
      textarea.setSelectionRange(caret, caret);
    }, 0);
  };
  const fmtBold = () => wrapSelection('**', '**');
  const fmtItalic = () => wrapSelection('*', '*');
  const fmtLink = () => wrapSelection('[', '](https://)');

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); fmtBold(); return; }
      if (k === 'i') { e.preventDefault(); fmtItalic(); return; }
    }
    if (mentions().length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => Math.min(i + 1, mentions().length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const m = mentions()[mentionIdx()];
        if (m) { e.preventDefault(); insertMention(m.username); return; }
      }
      if (e.key === 'Escape') { setMentions([]); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); }
  };

  return (
    <div class="composer mb-8 p-5 bg-surface-container border border-outline-variant rounded-2xl relative transition-colors focus-within:border-primary/40">
      <div class="flex gap-4">
        <Avatar url={me()?.avatar_url} name={me()?.display_name} size={48} class="rounded-lg" />
        <div class="flex-1 min-w-0">
          <Show when={!props.replyToId}>
            <input
              type="text"
              placeholder={t('compose.cw_placeholder')}
              maxlength="140"
              value={cw()}
              onInput={(e) => setCw(e.currentTarget.value)}
              class="mb-3 font-mono text-[13px] bg-surface-container-lowest border-outline-variant/50"
            />
          </Show>
          <textarea
            ref={textarea}
            placeholder={props.placeholder ?? t('compose.placeholder')}
            value={body()}
            onInput={onInput}
            onKeyDown={onKeyDown}
            disabled={busy()}
            class="w-full bg-transparent border-none focus:ring-0 resize-none h-24 text-on-surface placeholder:text-on-surface-variant/50"
            style="font-family: 'Geist', sans-serif; font-size: 16px; line-height: 1.5;"
          />

          {/* @-mention typeahead */}
          <Show when={mentions().length > 0}>
            <div class="absolute left-20 right-6 bg-surface-container-high border border-outline-variant rounded-lg max-h-48 overflow-y-auto z-10 shadow-lg">
              <For each={mentions()}>
                {(m, i) => (
                  <div
                    onMouseDown={(e) => { e.preventDefault(); insertMention(m.username); }}
                    onMouseEnter={() => setMentionIdx(i())}
                    class={`px-3 py-2 cursor-pointer text-[13px] ${i() === mentionIdx() ? 'bg-surface-container-highest' : ''}`}
                  >
                    <span class="font-bold text-primary font-mono">@{m.username}</span>
                    <span class="text-on-surface-variant ml-2">{m.display_name}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            class="hidden"
            onChange={upload}
          />

          <Show when={err()}>
            <div class="error">{err()}</div>
          </Show>

          {/* Live preview of the first link in the draft */}
          <Show when={livePreview()}>
            {(u) => (
              <LinkCard url={u()} interactive={false} onRemove={() => setDismissedUrl(previewUrl())} />
            )}
          </Show>

          <div class="flex justify-between items-center mt-4 pt-4 border-t border-outline-variant/30">
            <div class="flex items-center gap-0.5">
              <button
                type="button"
                onClick={fmtBold}
                class="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors"
                title={`${t('compose.fmt.bold')} (⌘B)`}
              >
                <span class="material-symbols-outlined" style="font-size:20px;">format_bold</span>
              </button>
              <button
                type="button"
                onClick={fmtItalic}
                class="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors"
                title={`${t('compose.fmt.italic')} (⌘I)`}
              >
                <span class="material-symbols-outlined" style="font-size:20px;">format_italic</span>
              </button>
              <button
                type="button"
                onClick={fmtLink}
                class="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors"
                title={t('compose.fmt.link')}
              >
                <span class="material-symbols-outlined" style="font-size:20px;">link</span>
              </button>
              <span class="w-px h-5 bg-outline-variant/50 mx-1"></span>
              <button
                type="button"
                onClick={pickFile}
                disabled={uploading() || busy()}
                class="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors"
                title={t('compose.add_image')}
              >
                <span class="material-symbols-outlined">image</span>
              </button>
              <button
                onClick={() => insertAtCursor('\n```\n\n```\n')}
                class="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors"
                title={t('compose.code_block')}
              >
                <span class="material-symbols-outlined">code</span>
              </button>
              <EmojiPicker onPick={insertAtCursor} />
              <Show when={uploading()}>
                <span class="text-on-surface-variant font-mono text-[11px] ml-1">{t('compose.uploading')}</span>
              </Show>
            </div>
            <div class="flex items-center gap-3">
              <span
                class={`char-count ${
                  visibleLength(body()) > MAX ? 'bad' : visibleLength(body()) > MAX * 0.9 ? 'warn' : ''
                }`}
              >
                {visibleLength(body())} / {MAX}
              </span>
              <button
                onClick={submit}
                disabled={busy() || !body().trim() || visibleLength(body()) > MAX}
                class="px-6 py-2 bg-primary text-on-primary font-bold rounded-lg font-mono text-[14px] active:scale-95 transition-all hover:opacity-90 disabled:opacity-50"
              >
                {busy() ? t('compose.sending') : (props.replyToId ? t('compose.reply') : t('compose.send'))}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
