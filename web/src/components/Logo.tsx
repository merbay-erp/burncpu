import { createUniqueId } from 'solid-js';

// burncpu brand mark — a clean flame in fire colors (amber → orange → red):
// "burn". Filled with a warm gradient so it actually reads as fire and pops
// against the green UI. `size`/`class` still control sizing & positioning.
export default function Logo(props: { size?: number; class?: string }) {
  const s = () => props.size ?? 24;
  const gid = `bc-flame-${createUniqueId()}`;
  return (
    <svg
      width={s()}
      height={s()}
      viewBox="0 0 24 24"
      fill="none"
      class={props.class}
      role="img"
      aria-label="burncpu"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#ff3d2e" />
          <stop offset="0.5" stop-color="#ff8a1a" />
          <stop offset="1" stop-color="#ffd24a" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gid})`}
        d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
      />
    </svg>
  );
}
