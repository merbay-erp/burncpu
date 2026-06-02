import { For } from 'solid-js';

// Shimmer bar. `class` controls size/rounding per use.
export function Bar(props: { class?: string }) {
  return <div class={`skeleton rounded ${props.class ?? ''}`} />;
}

// One post-card placeholder, matching the real Post card geometry.
export function PostSkeleton() {
  return (
    <div class="p-5 sm:p-6 bg-surface-container-low border border-outline-variant rounded-2xl">
      <div class="flex gap-4">
        <Bar class="!rounded-xl w-10 h-10 shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <Bar class="h-3.5 w-32" />
            <Bar class="h-3 w-16" />
          </div>
          <div class="mt-3.5 space-y-2.5">
            <Bar class="h-3 w-full" />
            <Bar class="h-3 w-11/12" />
            <Bar class="h-3 w-2/3" />
          </div>
          <div class="flex gap-3 mt-5">
            <Bar class="!rounded-lg h-6 w-12" />
            <Bar class="!rounded-lg h-6 w-12" />
          </div>
        </div>
      </div>
    </div>
  );
}

// A run of post placeholders for timeline / profile loading states.
export function PostSkeletonList(props: { count?: number }) {
  return (
    <div class="space-y-6">
      <For each={Array.from({ length: props.count ?? 5 })}>{() => <PostSkeleton />}</For>
    </div>
  );
}

// Profile header placeholder, matching the new header card.
export function ProfileHeaderSkeleton() {
  return (
    <div class="rounded-2xl border border-outline-variant bg-surface-container-low p-6 mb-6">
      <div class="flex items-start gap-4">
        <Bar class="!rounded-2xl w-20 h-20 shrink-0" />
        <div class="flex-1 min-w-0 pt-1">
          <Bar class="h-5 w-48" />
          <Bar class="h-3.5 w-28 mt-2" />
          <Bar class="h-3 w-full mt-3" />
        </div>
      </div>
      <div class="flex gap-5 mt-5">
        <Bar class="h-3.5 w-16" />
        <Bar class="h-3.5 w-20" />
        <Bar class="h-3.5 w-16" />
      </div>
    </div>
  );
}
