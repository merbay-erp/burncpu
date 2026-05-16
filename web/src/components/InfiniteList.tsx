import { onCleanup, onMount, type JSX } from 'solid-js';

/// Renders `children`, then a sentinel div. When the sentinel intersects
/// the viewport, calls `onLoadMore`. Stops once `done` is true. Cheap —
/// uses IntersectionObserver, no scroll-listener thrashing.
export default function InfiniteList(props: {
  children: JSX.Element;
  onLoadMore: () => void;
  loading: boolean;
  done: boolean;
}) {
  let sentinel: HTMLDivElement | undefined;
  let observer: IntersectionObserver | undefined;

  onMount(() => {
    if (!sentinel) return;
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !props.loading && !props.done) {
            props.onLoadMore();
          }
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
  });

  onCleanup(() => observer?.disconnect());

  return (
    <>
      {props.children}
      <div ref={sentinel} style="height: 1px;" />
      {props.loading ? (
        <div class="muted tiny" style="text-align: center; padding: 12px;">
          <span class="spinner" /> daha yüklüyor…
        </div>
      ) : props.done ? (
        <div class="muted tiny" style="text-align: center; padding: 12px;">
          son.
        </div>
      ) : null}
    </>
  );
}
