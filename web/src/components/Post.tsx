import { Show, createSignal, createEffect } from 'solid-js';
import { A } from '@solidjs/router';
import type { PostView } from '../api';
import { api } from '../api';
import { me } from '../auth';
import { pushToast } from './Toast';
import Compose from './Compose';
import LinkCard from './LinkCard';
import Avatar from './Avatar';
import { relTime, visibleLength, firstUrl } from '../util';
import { t } from '../i18n';

// "Yaşlı mühendis kulübü" pact: single-emoji react (the brand turtle).
// Backend still accepts the full set — re-enable by widening this array.
const REACT_EMOJI = '\u{1F422}'; // 🐢
const MAX_LEN = 5000;

const ACTION_BTN = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors';

export default function Post(props: {
  post: PostView;
  onChange?: () => void;
  // Thread view: when set, the reply action triggers an inline reply box for
  // THIS post instead of navigating to its conversation page.
  onReply?: () => void;
  // Thread view renders parentage via nesting, so the inline parent excerpt is
  // redundant noise there.
  hideParent?: boolean;
  // Highlight the post the viewer navigated to within a thread.
  highlight?: boolean;
}) {
  if (!props.post || !props.post.author) return null;

  const [reactionsTotal, setReactionsTotal] = createSignal(props.post.reactions_count);
  // 19 May 2026 — Initial state backend'den geliyor (viewer_reacted/viewer_bookmarked).
  // Onceden hep false ile basliyordu → sayfa refresh sonrasi 🐢 ve bookmark
  // ikonlari kayboluyordu. createEffect ile props guncellendiginde sync.
  const [reacted, setReacted] = createSignal(props.post.viewer_reacted ?? false);
  const [busy, setBusy] = createSignal(false);
  const [bookmarked, setBookmarked] = createSignal(props.post.viewer_bookmarked ?? false);
  // Inline reply box (timeline/feed/profile). In thread view the parent owns
  // the reply box via `onReply`, so this stays closed there.
  const [replyOpen, setReplyOpen] = createSignal(false);
  const [repliesTotal, setRepliesTotal] = createSignal(props.post.replies_count);

  createEffect(() => {
    if (typeof props.post.viewer_reacted === 'boolean') setReacted(props.post.viewer_reacted);
    if (typeof props.post.viewer_bookmarked === 'boolean') setBookmarked(props.post.viewer_bookmarked);
    // Reconcile the counts too — otherwise fresh server data (another user's
    // concurrent reaction, a refetch) leaves the displayed number stale while
    // the reacted/bookmarked icons update. The optimistic +1/-1 is preserved
    // between fetches because this effect only re-runs when props.post.*
    // actually changes.
    setReactionsTotal(props.post.reactions_count);
    setRepliesTotal(props.post.replies_count);
  });

  // Reply icon: in thread view delegate to the parent (tree placement);
  // otherwise toggle an inline box right under this post.
  const onReplyClick = () => {
    if (props.onReply) props.onReply();
    else setReplyOpen((v) => !v);
  };
  const onInlineReplied = () => {
    setReplyOpen(false);
    setRepliesTotal((n) => n + 1);
    pushToast(t('post.reply_sent'), 'ok');
  };
  const [editing, setEditing] = createSignal(false);
  const [editBody, setEditBody] = createSignal(props.post.body);
  const [body, setBody] = createSignal(props.post.body);
  const [bodyHtml, setBodyHtml] = createSignal(props.post.body_html);
  const [edited, setEdited] = createSignal(false);
  const [deleted, setDeleted] = createSignal(false);
  const [cwOpen, setCwOpen] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);

  const isMine  = () => me()?.username === props.post.author.username;
  const isAdmin = () => me()?.role === 'admin';
  const isRecent = () => {
    const t = Date.parse(props.post.created_at);
    return Number.isFinite(t) && (Date.now() - t) < 1000 * 60 * 30; // 30min
  };

  const toggleReact = async () => {
    if (!me() || busy()) return;
    setBusy(true);
    try {
      if (reacted()) {
        await api.del(`/posts/${props.post.id}/react`);
        setReacted(false);
        setReactionsTotal((n) => Math.max(0, n - 1));
      } else {
        await api.post(`/posts/${props.post.id}/react`, { emoji: REACT_EMOJI });
        setReacted(true);
        setReactionsTotal((n) => n + 1);
      }
    } finally { setBusy(false); }
  };

  const toggleBookmark = async () => {
    if (!me() || busy()) return;
    setBusy(true);
    try {
      if (bookmarked()) { await api.del(`/bookmarks/${props.post.id}`); setBookmarked(false); }
      else { await api.post(`/bookmarks/${props.post.id}`); setBookmarked(true); }
    } finally { setBusy(false); }
  };

  const saveEdit = async () => {
    if (busy() || !editBody().trim()) return;
    setBusy(true);
    try {
      const u = await api.patch<PostView>(`/posts/${props.post.id}`, { body: editBody().trim() });
      setBody(u.body); setBodyHtml(u.body_html); setEdited(true); setEditing(false);
    } catch (e) { pushToast((e as Error).message, 'warn'); }
    finally { setBusy(false); }
  };

  const deleteIt = async () => {
    if (!confirm(t('post.delete_confirm'))) return;
    await api.del(`/posts/${props.post.id}`);
    setDeleted(true);
    props.onChange?.();
  };

  const share = async () => {
    const url = `${window.location.origin}/posts/${props.post.id}`;
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ url, title: `@${props.post.author.username} — burncpu` }); return; }
      catch { /* fall through */ }
    }
    try { await navigator.clipboard.writeText(url); pushToast(t('post.link_copied'), 'ok'); }
    catch { pushToast('Link: ' + url); }
  };

  const report = async () => {
    const reason = prompt(t('post.report_reason_prompt'), 'spam');
    if (!reason) return;
    if (!['spam', 'harassment', 'illegal', 'other'].includes(reason)) {
      pushToast(t('post.report_invalid'), 'warn'); return;
    }
    const note = prompt(t('post.report_note_prompt')) ?? '';
    try {
      await api.post('/reports', { target_kind: 'post', target_id: props.post.id, reason, note: note || null });
      pushToast(t('post.report_sent'), 'ok');
    } catch (e) { pushToast((e as Error).message, 'warn'); }
  };

  const togglePin = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await api.post(`/users/me/pin/${props.post.id}`);
      pushToast(t('post.pinned'), 'ok');
    } catch (e) { pushToast((e as Error).message, 'warn'); }
    finally { setBusy(false); }
  };

  if (deleted()) {
    return (
      <article class="p-6 bg-surface-container-low border border-outline-variant rounded-xl">
        <div class="text-on-surface-variant text-[12px] font-mono">{t('post.transmission_ceased')}</div>
      </article>
    );
  }

  return (
    <article
      class={`p-5 sm:p-6 bg-surface-container-low border rounded-2xl transition-all duration-200 hover:border-primary/40 hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)] ${
        props.highlight ? 'border-primary ring-2 ring-primary/40' : 'border-outline-variant'
      }`}
    >
      {/* parent quote (reply context) */}
      <Show when={!props.hideParent && props.post.parent}>
        {(p) => (
          <A href={`/posts/${p().id}`} class="block mb-4">
            <div class="bg-surface-container border-l-2 border-primary px-3 py-2 rounded-r text-[13px]">
              <span class="text-on-surface-variant font-mono">↳ @{p().author_username}</span>
              <div class="text-on-surface-variant mt-1 line-clamp-2">{p().excerpt}</div>
            </div>
          </A>
        )}
      </Show>

      <div class="flex gap-4">
        {/* Avatar */}
        <A href={`/u/${props.post.author.username}`} class="flex-shrink-0">
          <Avatar
            url={props.post.author.avatar_url}
            name={props.post.author.display_name}
            size={40}
            class="rounded-xl ring-1 ring-outline-variant/60 transition-transform hover:scale-105"
          />
        </A>

        <div class="flex-1 min-w-0">
          {/* Head */}
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5 min-w-0">
              <A href={`/u/${props.post.author.username}`} class="font-bold text-on-background truncate hover:underline decoration-primary/50 decoration-2 underline-offset-2">
                {props.post.author.display_name}
              </A>
              <A href={`/u/${props.post.author.username}`} class="text-on-surface-variant font-mono text-[12px] truncate shrink hover:text-primary transition-colors">
                @{props.post.author.username}
              </A>
              <A href={`/posts/${props.post.id}`} class="text-on-surface-variant font-mono text-[12px] shrink-0 hover:text-primary transition-colors">
                · {relTime(props.post.created_at)}<Show when={edited()}> · {t('post.edit_marker')}</Show>
              </A>
              <Show when={isRecent()}>
                <span class="w-2 h-2 rounded-full bg-primary signal-pulse shrink-0"></span>
              </Show>
            </div>
            <div class="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                class="p-1.5 -mr-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
              >
                <span class="material-symbols-outlined" style="font-size:20px;">more_horiz</span>
              </button>
              <Show when={menuOpen()}>
                <div
                  onMouseLeave={() => setMenuOpen(false)}
                  class="absolute right-0 top-full mt-1 w-44 bg-surface-container-high border border-outline-variant rounded-lg shadow-lg z-30 py-1 text-[13px]"
                >
                  <MenuItem icon="share" label={t('post.menu.share')} onClick={() => { setMenuOpen(false); share(); }} />
                  <Show when={me()}>
                    <MenuItem
                      icon={bookmarked() ? 'bookmark' : 'bookmark_add'}
                      label={bookmarked() ? t('post.menu.unbookmark') : t('post.menu.bookmark')}
                      onClick={() => { setMenuOpen(false); toggleBookmark(); }}
                    />
                    <Show when={isMine()}>
                      <MenuItem icon="push_pin" label={t('post.menu.pin')} onClick={() => { setMenuOpen(false); togglePin(); }} />
                      <MenuItem icon="edit"     label={t('post.menu.edit')}          onClick={() => { setMenuOpen(false); setEditing(true); }} />
                    </Show>
                    <Show when={!isMine()}>
                      <MenuItem icon="flag" label={t('post.menu.report')} onClick={() => { setMenuOpen(false); report(); }} />
                    </Show>
                    <Show when={isMine() || isAdmin()}>
                      <MenuItem icon="delete" label={t('post.menu.delete')} danger onClick={() => { setMenuOpen(false); deleteIt(); }} />
                    </Show>
                  </Show>
                </div>
              </Show>
            </div>
          </div>

          {/* Body / CW fold / Editor */}
          <Show
            when={editing()}
            fallback={
              <Show
                when={props.post.content_warning && !cwOpen()}
                fallback={
                  <>
                    <div class="post-body mt-2 text-on-surface text-body-md" innerHTML={bodyHtml() || body()} />
                    <Show when={firstUrl(body())}>
                      {(u) => <LinkCard url={u()} />}
                    </Show>
                  </>
                }
              >
                <div class="mt-3 p-3 bg-surface-container border border-outline-variant rounded-lg">
                  <div class="text-[10px] font-mono uppercase tracking-widest text-primary">⚠ {t('post.content_warning')}</div>
                  <div class="mt-1 text-on-surface">{props.post.content_warning}</div>
                  <button
                    onClick={() => setCwOpen(true)}
                    class="mt-2 text-[12px] font-mono text-primary hover:underline"
                  >
                    {t('post.cw_show')} ↓
                  </button>
                </div>
              </Show>
            }
          >
            <textarea
              value={editBody()}
              onInput={(e) => setEditBody(e.currentTarget.value)}
              maxlength={MAX_LEN}
              rows={3}
              class="mt-2"
            />
            <div class="flex justify-end gap-2 mt-2 text-[12px]">
              <span class="char-count self-center mr-auto">{visibleLength(editBody())}/{MAX_LEN}</span>
              <button onClick={() => { setEditing(false); setEditBody(body()); }} class="px-3 py-1 font-mono text-on-surface-variant hover:text-primary">
                {t('common.cancel')}
              </button>
              <button onClick={saveEdit} disabled={busy() || !editBody().trim()} class="px-3 py-1 bg-primary text-on-primary font-bold rounded font-mono">
                {t('post.save_edit')}
              </button>
            </div>
          </Show>

          {/* Footer actions */}
          <div class="flex gap-1 mt-4 -ml-2.5 items-center">
            <Show
              when={props.onReply || me()}
              fallback={
                <A href={`/posts/${props.post.id}`} class={ACTION_BTN} title={t('post.reply')}>
                  <span class="material-symbols-outlined" style="font-size: 18px;">chat_bubble</span>
                  <Show when={repliesTotal() > 0}>
                    <span class="font-mono text-[12px]">{repliesTotal()}</span>
                  </Show>
                </A>
              }
            >
              <button
                class={ACTION_BTN + (replyOpen() ? ' text-primary' : '')}
                onClick={onReplyClick}
                title={t('compose.reply')}
              >
                <span class="material-symbols-outlined" style="font-size: 18px;">reply</span>
                <Show when={repliesTotal() > 0}>
                  <span class="font-mono text-[12px]">{repliesTotal()}</span>
                </Show>
              </button>
            </Show>
            <button
              class={ACTION_BTN + (reacted() ? ' text-primary' : '')}
              onClick={toggleReact}
              disabled={!me() || busy()}
              title={me() ? t('post.react') : t('post.react_login')}
            >
              <span
                class="material-symbols-outlined"
                style={reacted() ? "font-size: 18px; font-variation-settings: 'FILL' 1;" : 'font-size: 18px;'}
              >
                favorite
              </span>
              <Show when={reactionsTotal() > 0}>
                <span class={`font-mono text-[12px] ${reacted() ? 'text-primary' : ''}`}>
                  {reactionsTotal()}
                </span>
              </Show>
            </button>
            <button class={ACTION_BTN + ' ml-auto'} onClick={share} title={t('post.menu.share')}>
              <span class="material-symbols-outlined" style="font-size: 18px;">share</span>
            </button>
          </div>

          {/* Inline reply box — opens right under the post (timeline / feed /
              profile) instead of bouncing to a separate page. */}
          <Show when={!props.onReply && replyOpen() && me()}>
            <div class="mt-4">
              <Compose
                replyToId={props.post.id}
                placeholder={`@${props.post.author.username} ${t('thread.reply_to')}`}
                autofocus
                onPosted={onInlineReplied}
              />
            </div>
          </Show>
        </div>
      </div>
    </article>
  );
}

function MenuItem(props: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={props.onClick}
      class={`w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-container-highest text-left ${props.danger ? 'text-error' : 'text-on-background'}`}
    >
      <span class="material-symbols-outlined" style="font-size: 18px;">{props.icon}</span>
      <span class="font-mono text-[13px]">{props.label}</span>
    </button>
  );
}
