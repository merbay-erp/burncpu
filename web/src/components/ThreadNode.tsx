import { For, Show } from 'solid-js';
import type { PostView } from '../api';
import Post from './Post';
import Compose from './Compose';
import { me } from '../auth';
import { t } from '../i18n';

// Shared per-thread context, drilled down through the recursion so each node
// can look up its own children, toggle its own reply box, and report a new
// reply back up to the page.
export interface ThreadCtx {
  childrenOf: (id: string) => PostView[];
  replyingTo: () => string | null;
  setReplyingTo: (id: string | null) => void;
  onReplied: (p: PostView) => void;
  onChange: () => void;
  highlightId: string;
}

// One node of the conversation tree: the post, an inline reply box when open,
// then its children nested one level deeper behind a vertical guide line.
export default function ThreadNode(props: { post: PostView; depth: number; ctx: ThreadCtx }) {
  const kids = () => props.ctx.childrenOf(props.post.id);
  const replying = () => props.ctx.replyingTo() === props.post.id;

  return (
    <div>
      <Post
        post={props.post}
        hideParent
        highlight={props.post.id === props.ctx.highlightId}
        onReply={() => props.ctx.setReplyingTo(replying() ? null : props.post.id)}
        onChange={props.ctx.onChange}
      />

      <Show when={me() && replying()}>
        <div class="mt-2">
          <Compose
            replyToId={props.post.id}
            placeholder={`@${props.post.author.username} ${t('thread.reply_to')}`}
            autofocus
            onPosted={(p) => {
              props.ctx.onReplied(p);
              props.ctx.setReplyingTo(null);
            }}
          />
        </div>
      </Show>

      <Show when={kids().length > 0}>
        <div class="mt-3 ml-3 sm:ml-5 pl-3 sm:pl-5 border-l-2 border-outline-variant space-y-3">
          <For each={kids()}>
            {(child) => <ThreadNode post={child} depth={props.depth + 1} ctx={props.ctx} />}
          </For>
        </div>
      </Show>
    </div>
  );
}
