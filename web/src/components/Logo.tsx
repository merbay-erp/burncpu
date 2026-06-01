// burncpu brand mark — a flame rising from a CPU chip: "burn" (the fire) +
// "cpu" (the chip + contact pins + glowing core). The inner flame is a true
// transparent cutout (fill-rule evenodd), so it reads on any background, and
// the core slow-pulses (the "signal"). Monoline + currentColor, so the caller
// sets the hue via text-* utilities.
export default function Logo(props: { size?: number; class?: string }) {
  const s = () => props.size ?? 24;
  return (
    <svg
      width={s()}
      height={s()}
      viewBox="0 0 48 48"
      fill="none"
      class={props.class}
      role="img"
      aria-label="burncpu"
    >
      {/* flame (outer body with an inner flame knocked out) */}
      <path
        fill="currentColor"
        fill-rule="evenodd"
        d="M24 2.5 C27 8 30 10.6 29.6 15.4 C29.3 19 27.2 20.6 28 23.8
           C29 28 26.4 30.5 24 30.5 C20.2 30.5 17 27.6 17.9 22.9
           C18.4 19.7 20.7 18.4 20.3 14.8 C19.9 10.8 18.2 12.2 19.4 8
           C20.5 4.6 22 5.4 24 2.5 Z
           M24 17 C25.8 19.9 26.9 21.8 26.3 24.9 C25.9 27.4 24 28.1 22.8 27.6
           C21.1 27 20.7 24.8 21.4 22.6 C22 20.4 22.8 19.8 24 17 Z"
      />
      {/* CPU-chip body + contact pins */}
      <g
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="15.5" y="29" width="17" height="12.5" rx="3" />
        <path d="M15.5 33.5 H11.5 M15.5 38 H11.5 M32.5 33.5 H36.5 M32.5 38 H36.5 M20 41.5 V45 M24 41.5 V45 M28 41.5 V45" />
      </g>
      {/* glowing core */}
      <circle cx="24" cy="35.3" r="2" fill="currentColor" class="burncpu-logo-core" />
    </svg>
  );
}
