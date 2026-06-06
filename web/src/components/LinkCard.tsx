import { Show, createResource, createMemo, createEffect, type JSX } from 'solid-js';
import { fetchLinkPreview, type LinkPreview } from '../api';

// Dedupe across every card in the session: the same URL is fetched once, and
// the server caches on top of that. Keyed by the raw URL string.
const cache = new Map<string, Promise<LinkPreview | null>>();
function load(url: string): Promise<LinkPreview | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetchLinkPreview(url)
      .then((r) => r.preview)
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

function hostOf(u: string): string {
  try {
    return new URL(u).host.replace(/^www\./, '');
  } catch {
    return u;
  }
}

/**
 * Rich "unfurl" card for a URL. Renders nothing until a preview resolves (and
 * nothing at all if the link has no usable metadata), so it never leaves an
 * empty box behind.
 *
 * - default: a clickable <a> card for timelines.
 * - `interactive={false}` + `onRemove`: a non-navigating, dismissible card for
 *   the composer's live preview.
 */
export default function LinkCard(props: {
  url: string;
  interactive?: boolean;
  onRemove?: () => void;
  // Fired once the fetch settles: true if a card rendered, false if no preview.
  onResolved?: (hasPreview: boolean) => void;
  /** Above-the-fold first card: load the cover eagerly + high priority (it's the LCP image). */
  eager?: boolean;
}) {
  const [data] = createResource(() => props.url, load);
  const preview = createMemo(() => data() ?? null);
  const interactive = () => props.interactive !== false;

  createEffect(() => {
    if (data.loading) return;
    props.onResolved?.(preview() != null);
  });

  const Inner = (p: LinkPreview): JSX.Element => (
    <>
      <Show when={p.image}>
        <div class="lp-image relative aspect-[1.91/1] w-full overflow-hidden bg-surface-container">
          <img
            src={p.image}
            alt=""
            loading={props.eager ? 'eager' : 'lazy'}
            fetchpriority={props.eager ? 'high' : undefined}
            referrerpolicy="no-referrer"
            class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            onError={(e) => e.currentTarget.parentElement?.remove()}
          />
        </div>
      </Show>
      <div class="p-3">
        <div class="flex items-center gap-1.5 text-on-surface-variant">
          <Show when={p.favicon}>
            <img
              src={p.favicon}
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
              class="h-3.5 w-3.5 rounded-sm shrink-0"
              onError={(e) => e.currentTarget.remove()}
            />
          </Show>
          <span class="font-mono text-[11px] tracking-wide truncate">
            {p.site_name || hostOf(p.url)}
          </span>
        </div>
        <Show when={p.title}>
          <div class="mt-1 font-semibold text-[14px] leading-snug text-on-surface line-clamp-2">
            {p.title}
          </div>
        </Show>
        <Show when={p.description}>
          <div class="mt-1 text-[13px] leading-snug text-on-surface-variant line-clamp-2">
            {p.description}
          </div>
        </Show>
      </div>
    </>
  );

  return (
    <Show when={preview()}>
      {(p) => (
        <Show
          when={interactive()}
          fallback={
            <div class="lp-card group relative mt-2 block overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low">
              {Inner(p())}
              <Show when={props.onRemove}>
                <button
                  type="button"
                  aria-label="remove preview"
                  onClick={() => props.onRemove?.()}
                  class="absolute top-2 right-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-background/80 text-on-surface-variant backdrop-blur hover:text-primary transition-colors"
                >
                  <span class="material-symbols-outlined" style="font-size:18px;">close</span>
                </button>
              </Show>
            </div>
          }
        >
          <a
            href={p().url}
            target="_blank"
            rel="noopener noreferrer ugc"
            class="lp-card group mt-3 block overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low hover:border-primary/50 transition-colors"
          >
            {Inner(p())}
          </a>
        </Show>
      )}
    </Show>
  );
}
