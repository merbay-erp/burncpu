import { createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { A } from '@solidjs/router';
import { api, type Timeline, type PostView } from '../api';
import { me } from '../auth';
import { relTime } from '../util';
import { t } from '../i18n';

// Vertical full-screen video feed (the "Reels"/Shorts tab). Reads /feed/videos
// (public posts that carry a clip), one clip per screenful, CSS scroll-snap so
// each swipe lands on the next. The on-screen clip plays muted+looping; tapping
// it toggles sound. This is the deliberate place for "kaydırma" — the normal
// timeline stays a mixed feed.

const VIDEO_RE = /!\[[^\]]*\]\((\/media\/[^)\s]+\.(?:mp4|webm|mov))\)/i;
const MEDIA_RE = /!\[[^\]]*\]\([^)]*\)/g;
const REACT_EMOJI = '\u{1F422}'; // 🐢 — same single-emoji react as the timeline

function firstVideo(body: string): string | null {
  const m = VIDEO_RE.exec(body);
  return m ? m[1] : null;
}
function caption(body: string): string {
  return body.replace(MEDIA_RE, '').trim();
}

export default function Videos() {
  const [posts, setPosts] = createSignal<PostView[]>([]);
  const [cursor, setCursor] = createSignal<{ before: string; id?: string } | null>(null);
  const [done, setDone] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [ready, setReady] = createSignal(false);

  const load = async () => {
    if (loading() || done()) return;
    setLoading(true);
    try {
      const c = cursor();
      const qs = c
        ? `?limit=8&before=${encodeURIComponent(c.before)}${c.id ? `&before_id=${c.id}` : ''}`
        : '?limit=8';
      const page = await api.get<Timeline>(`/feed/videos${qs}`).catch(() => null);
      if (!page) {
        setDone(true);
        return;
      }
      const withClip = page.posts.filter((x) => firstVideo(x.body));
      setPosts((p) => [...p, ...withClip]);
      if (page.next_before) setCursor({ before: page.next_before, id: page.next_before_id ?? undefined });
      else setDone(true);
    } finally {
      setLoading(false);
      setReady(true);
    }
  };
  onMount(load);

  return (
    <div class="-mx-4 md:-mx-6 -mt-2 h-[calc(100vh-4.5rem)] overflow-y-auto snap-y snap-mandatory bg-black rounded-xl">
      <Show
        when={ready()}
        fallback={<div class="h-full grid place-items-center text-white/60 font-mono text-sm">…</div>}
      >
        <Show
          when={posts().length > 0}
          fallback={
            <div class="h-full grid place-items-center px-8 text-center">
              <div>
                <span class="material-symbols-outlined text-white/40 text-[44px]">movie</span>
                <p class="mt-2 text-white/80 font-medium">{t('videos.empty_title')}</p>
                <p class="mt-1 text-white/50 text-sm max-w-xs mx-auto">{t('videos.empty_body')}</p>
              </div>
            </div>
          }
        >
          <For each={posts()}>{(p) => <Slide post={p} onNearEnd={load} />}</For>
        </Show>
      </Show>
    </div>
  );
}

function Slide(props: { post: PostView; onNearEnd: () => void }) {
  let videoEl: HTMLVideoElement | undefined;
  let rootEl: HTMLDivElement | undefined;
  const [muted, setMuted] = createSignal(true);
  const [reacted, setReacted] = createSignal(!!props.post.viewer_reacted);
  const [reactions, setReactions] = createSignal(props.post.reactions_count);
  const src = firstVideo(props.post.body) ?? '';
  const text = caption(props.post.body);

  onMount(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.7) {
            void videoEl?.play().catch(() => {});
            props.onNearEnd();
          } else {
            videoEl?.pause();
          }
        }
      },
      { threshold: [0, 0.7, 1] },
    );
    if (rootEl) io.observe(rootEl);
    onCleanup(() => io.disconnect());
  });

  const toggleReact = async () => {
    if (!me()) return;
    if (reacted()) {
      setReacted(false);
      setReactions((n) => Math.max(0, n - 1));
      await api.del(`/posts/${props.post.id}/react`).catch(() => {});
    } else {
      setReacted(true);
      setReactions((n) => n + 1);
      await api.post(`/posts/${props.post.id}/react`, { emoji: REACT_EMOJI }).catch(() => {});
    }
  };

  return (
    <div ref={rootEl} class="h-full w-full snap-start relative grid place-items-center overflow-hidden">
      {/* eslint-disable-next-line */}
      <video
        ref={videoEl}
        src={src}
        muted={muted()}
        loop
        playsinline
        preload="metadata"
        class="max-h-full max-w-full"
        onClick={() => setMuted((m) => !m)}
      />

      {/* mute hint */}
      <Show when={muted()}>
        <div class="absolute top-4 right-4 bg-black/50 rounded-full px-2.5 py-1 flex items-center gap-1 text-white/90 text-[12px] pointer-events-none">
          <span class="material-symbols-outlined text-[16px]">volume_off</span>
          {t('videos.tap_sound')}
        </div>
      </Show>

      {/* author + caption */}
      <div class="absolute left-0 right-16 bottom-0 p-4 bg-gradient-to-t from-black/70 to-transparent">
        <A href={`/u/${props.post.author.username}`} class="flex items-center gap-2 mb-1.5">
          <Show
            when={props.post.author.avatar_url}
            fallback={<div class="w-8 h-8 rounded-full bg-white/20 grid place-items-center text-sm">🐢</div>}
          >
            <img src={props.post.author.avatar_url!} alt="" class="w-8 h-8 rounded-full object-cover" />
          </Show>
          <span class="font-semibold text-white text-sm">{props.post.author.display_name || props.post.author.username}</span>
          <span class="text-white/60 text-[12px] font-mono">@{props.post.author.username}</span>
        </A>
        <Show when={text}>
          <p class="text-white/90 text-sm line-clamp-3">{text}</p>
        </Show>
        <span class="text-white/40 text-[11px] font-mono">{relTime(props.post.created_at)}</span>
      </div>

      {/* react rail */}
      <div class="absolute right-3 bottom-6 flex flex-col items-center gap-4">
        <button
          type="button"
          onClick={toggleReact}
          aria-label="react"
          class={`flex flex-col items-center gap-1 transition-transform ${reacted() ? 'scale-110' : 'opacity-85'}`}
        >
          <span class={`text-[30px] leading-none ${reacted() ? '' : 'grayscale'}`}>{REACT_EMOJI}</span>
          <span class="text-white text-[12px] font-mono">{reactions()}</span>
        </button>
        <A href={`/posts/${props.post.id}`} class="flex flex-col items-center gap-1">
          <span class="material-symbols-outlined text-[28px] text-white">chat_bubble</span>
          <span class="text-white text-[12px] font-mono">{props.post.replies_count}</span>
        </A>
      </div>
    </div>
  );
}
