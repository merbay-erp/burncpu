import { Show, createSignal, For } from 'solid-js';
import { A } from '@solidjs/router';
import type { PostView } from '../api';
import { api } from '../api';
import { me } from '../auth';
import { relTime } from '../util';

const EMOJI = ['\u{1F525}', '\u{1F422}', '\u{1F91D}', '\u{1F64F}', '\u{1F602}'];

export default function Post(props: { post: PostView; onChange?: () => void }) {
  // If a refetch transiently delivers a stripped post, bail out cleanly
  // rather than throwing on `author.username` access.
  if (!props.post || !props.post.author) {
    return null;
  }
  const [reactionsTotal, setReactionsTotal] = createSignal(props.post.reactions_count);
  const [myReaction, setMyReaction] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

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
      props.onChange?.();
    } finally {
      setBusy(false);
    }
  };

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
        </A>
      </div>
      <div class="post-body" innerHTML={props.post.body_html} />
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
          {reactionsTotal()} tepki · <A href={`/posts/${props.post.id}`}>{props.post.replies_count} reply</A>
        </span>
      </div>
    </article>
  );
}
