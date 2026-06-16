import { createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { A } from '@solidjs/router';
import { api, type Timeline, type PostView } from '../api';
import { me } from '../auth';
import { relTime } from '../util';
import { t } from '../i18n';

// The "Videos" tab. Public posts that carry a clip, laid out as a compact
// portrait grid (like a Shorts/Reels gallery). Tapping a tile opens a centred
// phone-sized player — no more one-clip-per-screenful, which read as "too big".

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
  const [active, setActive] = createSignal<PostView | null>(null);

  const load = async () => {
    if (loading() || done()) return;
    setLoading(true);
    try {
      const c = cursor();
      const qs = c
        ? `?limit=12&before=${encodeURIComponent(c.before)}${c.id ? `&before_id=${c.id}` : ''}`
        : '?limit=12';
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

  // Infinite scroll: a sentinel near the page bottom pulls the next page.
  let sentinel: HTMLDivElement | undefined;
  onMount(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) void load();
      },
      { rootMargin: '700px' },
    );
    if (sentinel) io.observe(sentinel);
    onCleanup(() => io.disconnect());
  });

  return (
    <div>
      <header class="mb-4 flex items-center gap-2">
        <span class="material-symbols-outlined text-primary text-[24px]" style="font-variation-settings: 'FILL' 1;">movie</span>
        <h1 class="text-xl font-bold text-on-background">{t('nav.videos')}</h1>
      </header>

      <Show
        when={ready()}
        fallback={<div class="grid place-items-center py-20 text-on-surface-variant font-mono text-sm">…</div>}
      >
        <Show
          when={posts().length > 0}
          fallback={
            <div class="grid place-items-center py-20 px-8 text-center">
              <div>
                <span class="material-symbols-outlined text-on-surface-variant/40 text-[44px]">movie</span>
                <p class="mt-2 text-on-background font-medium">{t('videos.empty_title')}</p>
                <p class="mt-1 text-on-surface-variant text-sm max-w-xs mx-auto">{t('videos.empty_body')}</p>
              </div>
            </div>
          }
        >
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            <For each={posts()}>{(p) => <Tile post={p} onOpen={() => setActive(p)} />}</For>
          </div>
          <div ref={sentinel} class="h-12" />
        </Show>
      </Show>

      <Show when={active()}>{(p) => <Player post={p()} onClose={() => setActive(null)} />}</Show>
    </div>
  );
}

function Tile(props: { post: PostView; onOpen: () => void }) {
  let videoEl: HTMLVideoElement | undefined;
  const src = firstVideo(props.post.body) ?? '';

  return (
    <button
      type="button"
      onClick={props.onOpen}
      class="group relative aspect-[9/16] overflow-hidden rounded-lg bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onMouseEnter={() => void videoEl?.play().catch(() => {})}
      onMouseLeave={() => {
        if (videoEl) {
          videoEl.pause();
          try { videoEl.currentTime = 0.05; } catch { /* ignore */ }
        }
      }}
    >
      {/* eslint-disable-next-line */}
      <video
        ref={videoEl}
        src={src}
        muted
        loop
        playsinline
        preload="metadata"
        class="h-full w-full object-cover"
        // Nudge off frame 0 so browsers paint a real poster instead of black.
        onLoadedMetadata={() => { if (videoEl) try { videoEl.currentTime = 0.05; } catch { /* ignore */ } }}
      />

      {/* play affordance */}
      <span class="material-symbols-outlined absolute top-1.5 right-1.5 text-white/90 text-[20px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" style="font-variation-settings: 'FILL' 1;">play_circle</span>

      {/* author + react count */}
      <span class="absolute inset-x-0 bottom-0 flex items-center gap-1.5 p-1.5 bg-gradient-to-t from-black/70 to-transparent">
        <Show
          when={props.post.author.avatar_url}
          fallback={<span class="w-5 h-5 rounded-full bg-white/20 grid place-items-center text-[10px] shrink-0">🐢</span>}
        >
          <img src={props.post.author.avatar_url!} alt="" class="w-5 h-5 rounded-full object-cover shrink-0" />
        </Show>
        <span class="text-white text-[11px] font-mono truncate flex-1 text-left">@{props.post.author.username}</span>
        <Show when={props.post.reactions_count > 0}>
          <span class="text-white text-[11px] font-mono flex items-center gap-0.5 shrink-0">
            <span class="text-[12px] leading-none">{REACT_EMOJI}</span>
            {props.post.reactions_count}
          </span>
        </Show>
      </span>
    </button>
  );
}

function Player(props: { post: PostView; onClose: () => void }) {
  let videoEl: HTMLVideoElement | undefined;
  const [muted, setMuted] = createSignal(true);
  const [reacted, setReacted] = createSignal(!!props.post.viewer_reacted);
  const [reactions, setReactions] = createSignal(props.post.reactions_count);
  const src = firstVideo(props.post.body) ?? '';
  const text = caption(props.post.body);

  onMount(() => {
    void videoEl?.play().catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
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
    <div
      class="fixed inset-0 z-[80] bg-black/95 backdrop-blur-sm grid place-items-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
    >
      {/* close */}
      <button
        type="button"
        onClick={props.onClose}
        aria-label="close"
        class="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition-colors"
      >
        <span class="material-symbols-outlined">close</span>
      </button>

      <div class="relative aspect-[9/16] h-[86vh] max-w-[94vw] rounded-xl overflow-hidden bg-black">
        {/* eslint-disable-next-line */}
        <video
          ref={videoEl}
          src={src}
          muted={muted()}
          loop
          playsinline
          preload="metadata"
          class="absolute inset-0 h-full w-full object-contain"
          onClick={() => setMuted((m) => !m)}
        />

        {/* mute hint */}
        <Show when={muted()}>
          <div class="absolute top-3 left-3 bg-black/50 rounded-full px-2.5 py-1 flex items-center gap-1 text-white/90 text-[12px] pointer-events-none">
            <span class="material-symbols-outlined text-[16px]">volume_off</span>
            {t('videos.tap_sound')}
          </div>
        </Show>

        {/* author + caption */}
        <div class="absolute left-0 right-14 bottom-0 p-4 bg-gradient-to-t from-black/70 to-transparent">
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
    </div>
  );
}
