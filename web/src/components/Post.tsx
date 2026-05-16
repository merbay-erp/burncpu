import { Show, createSignal, For } from 'solid-js';
import { A } from '@solidjs/router';
import type { PostView } from '../api';
import { api } from '../api';
import { me } from '../auth';
import { pushToast } from './Toast';
import { relTime, visibleLength } from '../util';

const EMOJI = ['\u{1F525}', '\u{1F422}', '\u{1F91D}', '\u{1F64F}', '\u{1F602}'];
const MAX_LEN = 5000;

export default function Post(props: { post: PostView; onChange?: () => void }) {
  if (!props.post || !props.post.author) return null;

  const [reactionsTotal, setReactionsTotal] = createSignal(props.post.reactions_count);
  const [myReaction, setMyReaction] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [bookmarked, setBookmarked] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [editBody, setEditBody] = createSignal(props.post.body);
  const [body, setBody] = createSignal(props.post.body);
  const [bodyHtml, setBodyHtml] = createSignal(props.post.body_html);
  const [edited, setEdited] = createSignal(false);
  const [deleted, setDeleted] = createSignal(false);

  const isMine = () => me()?.username === props.post.author.username;
  const isAdmin = () => me()?.role === 'admin';

  const reactOrSwap = async (emoji: string) => {
    if (!me() || busy()) return;
    setBusy(true);
    try {
      if (myReaction() === emoji) {
        await api.del(`/posts/${props.post.id}/react`);
        setMyReaction(null);
        setReactionsTotal((n) => Math.max(0, n - 1));
      } else {
        await api.post(`/posts/${props.post.id}/react`, { emoji });
        if (!myReaction()) setReactionsTotal((n) => n + 1);
        setMyReaction(emoji);
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleBookmark = async () => {
    if (!me() || busy()) return;
    setBusy(true);
    try {
      if (bookmarked()) {
        await api.del(`/bookmarks/${props.post.id}`);
        setBookmarked(false);
      } else {
        await api.post(`/bookmarks/${props.post.id}`);
        setBookmarked(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (busy() || !editBody().trim()) return;
    setBusy(true);
    try {
      const updated = await api.patch<PostView>(`/posts/${props.post.id}`, {
        body: editBody().trim(),
      });
      setBody(updated.body);
      setBodyHtml(updated.body_html);
      setEdited(true);
      setEditing(false);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const repost = async () => {
    if (!me() || busy()) return;
    setBusy(true);
    try {
      await api.post(`/posts/${props.post.id}/repost`, {});
      props.onChange?.();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteIt = async () => {
    if (!confirm('Postu sil?')) return;
    await api.del(`/posts/${props.post.id}`);
    setDeleted(true);
    props.onChange?.();
  };

  const share = async () => {
    const url = `${window.location.origin}/posts/${props.post.id}`;
    const sharable = navigator.share as unknown;
    if (typeof sharable === 'function') {
      try {
        await (navigator.share as (d: ShareData) => Promise<void>)({
          url,
          title: `@${props.post.author.username} — burncpu`,
        });
        return;
      } catch {
        // user cancelled or unsupported — fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      pushToast('Link kopyalandı', 'ok');
    } catch {
      pushToast('Link: ' + url);
    }
  };

  const togglePin = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await api.post(`/users/me/pin/${props.post.id}`);
      pushToast('Profile sabitlendi', 'ok');
    } catch (e) {
      pushToast((e as Error).message, 'warn');
    } finally {
      setBusy(false);
    }
  };

  if (deleted()) {
    return (
      <article class="post">
        <div class="muted tiny">[silindi]</div>
      </article>
    );
  }

  return (
    <article class="post">
      <Show when={props.post.parent}>
        {(p) => (
          <A href={`/posts/${p().id}`} style="text-decoration: none; color: inherit;">
            <div class="parent-quote">
              <span class="handle">↳ @{p().author_username}</span>
              <div class="excerpt">{p().excerpt}</div>
            </div>
          </A>
        )}
      </Show>
      <div class="post-head">
        <A href={`/u/${props.post.author.username}`} class="name" style="color: inherit;">
          {props.post.author.display_name}
        </A>
        <A href={`/u/${props.post.author.username}`} class="handle" style="color: var(--fg-2);">
          @{props.post.author.username}
        </A>
        <A href={`/posts/${props.post.id}`} class="time" style="color: var(--fg-3);">
          {relTime(props.post.created_at)}
          <Show when={edited()}>
            {' '}
            <span class="muted">· edit</span>
          </Show>
        </A>
      </div>
      <Show
        when={editing()}
        fallback={<div class="post-body" innerHTML={bodyHtml() || body()} />}
      >
        <textarea
          value={editBody()}
          onInput={(e) => setEditBody(e.currentTarget.value)}
          maxlength={MAX_LEN}
          rows="3"
        />
        <div class="flex" style="margin-top: 6px; justify-content: flex-end;">
          <span class="char-count">{visibleLength(editBody())}/{MAX_LEN}</span>
          <button class="ghost tiny" onClick={() => { setEditing(false); setEditBody(body()); }}>iptal</button>
          <button class="primary tiny" onClick={saveEdit} disabled={busy() || !editBody().trim()}>
            Kaydet
          </button>
        </div>
      </Show>
      <div class="post-foot">
        <For each={EMOJI}>
          {(emoji) => (
            <button
              class={myReaction() === emoji ? 'active' : ''}
              onClick={() => reactOrSwap(emoji)}
              disabled={!me() || busy()}
              title={me() ? '' : 'tepki için giriş yap'}
            >
              {emoji}
            </button>
          )}
        </For>
        <span class="tiny muted">
          {reactionsTotal()} · <A href={`/posts/${props.post.id}`}>{props.post.replies_count} reply</A>
        </span>
        <button
          onClick={share}
          disabled={busy()}
          title="Paylaş"
          style="margin-left: auto;"
        >
          🔗
        </button>
        <Show when={me()}>
          <button
            class={bookmarked() ? 'active' : ''}
            onClick={toggleBookmark}
            disabled={busy()}
            title="Kaydet"
          >
            🔖
          </button>
          <button onClick={repost} disabled={busy()} title="Repost">
            🔁
          </button>
          <Show when={isMine()}>
            <button onClick={togglePin} disabled={busy()} title="Profile sabitle">
              📌
            </button>
            <button onClick={() => setEditing((v) => !v)} disabled={busy()} title="Düzenle">
              ✏️
            </button>
          </Show>
          <Show when={isMine() || isAdmin()}>
            <button onClick={deleteIt} disabled={busy()} title="Sil">
              🗑
            </button>
          </Show>
        </Show>
      </div>
    </article>
  );
}
