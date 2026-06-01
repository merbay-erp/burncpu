// burncpu brand mark — a top-down turtle whose shell is a CPU die:
// chip body + contact pins + inner die, with head, tail and four flippers,
// and a slow-pulsing core (the "signal"). Monoline, uses currentColor so the
// caller sets the hue via text-* utilities.
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
      <g
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        {/* flippers */}
        <path d="M16.5 15 11.5 10 M31.5 15 36.5 10 M16.5 33 11.5 38 M31.5 33 36.5 38" />
        {/* neck + tail */}
        <path d="M24 13 V8 M24 35 V40" />
        {/* CPU-chip shell */}
        <rect x="13" y="13" width="22" height="22" rx="5.5" />
        {/* contact pins */}
        <path d="M13 19 H9 M13 24 H9 M13 29 H9 M35 19 H39 M35 24 H39 M35 29 H39" />
        {/* die */}
        <rect x="19" y="19" width="10" height="10" rx="2.5" />
      </g>
      {/* head node */}
      <circle cx="24" cy="6.4" r="2.4" fill="currentColor" />
      {/* pulsing core */}
      <circle cx="24" cy="24" r="2.1" fill="currentColor" class="burncpu-logo-core" />
    </svg>
  );
}
