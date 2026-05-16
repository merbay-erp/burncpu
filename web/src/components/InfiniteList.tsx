import { onCleanup, onMount, type JSX } from 'solid-js';

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
          if (e.isIntersecting && !props.loading && !props.done) props.onLoadMore();
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
        <div class="w-full mt-12 py-4 text-on-surface-variant font-mono text-[14px] text-center">
          <span class="spinner mr-2" />SCANNING…
        </div>
      ) : !props.done ? (
        <button
          onClick={() => props.onLoadMore()}
          class="w-full mt-12 py-4 border border-dashed border-outline-variant text-on-surface-variant font-mono text-[14px] tracking-wider rounded-xl hover:text-primary hover:border-primary transition-all"
        >
          SCROLL FOR MORE SIGNAL
        </button>
      ) : (
        <div class="w-full mt-12 py-4 text-on-surface-variant font-mono text-[12px] text-center tracking-widest">
          END OF TRANSMISSION
        </div>
      )}
    </>
  );
}
