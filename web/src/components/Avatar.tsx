import { Show, createSignal, createEffect } from 'solid-js';

/**
 * User avatar: shows the uploaded image when present, else the 🐢 fallback.
 * Falls back to 🐢 too if the image URL is broken. The wrapper's rounding /
 * ring / hover is passed via `class` so callers control the shape per context.
 */
export default function Avatar(props: {
  url?: string | null;
  name?: string;
  size?: number;
  class?: string;
}) {
  const s = () => props.size ?? 40;
  const [broken, setBroken] = createSignal(false);
  // Reset the broken flag if the URL changes (e.g. after an avatar update).
  createEffect(() => {
    props.url;
    setBroken(false);
  });
  return (
    <div
      class={`bg-surface-container-highest flex items-center justify-center overflow-hidden shrink-0 ${props.class ?? 'rounded-xl'}`}
      style={`width:${s()}px;height:${s()}px`}
    >
      <Show
        when={props.url && !broken()}
        fallback={<span style={`font-size:${Math.round(s() * 0.5)}px;line-height:1`}>🐢</span>}
      >
        <img
          src={props.url!}
          alt={props.name ?? ''}
          loading="lazy"
          referrerpolicy="no-referrer"
          class="w-full h-full object-cover"
          onError={() => setBroken(true)}
        />
      </Show>
    </div>
  );
}
