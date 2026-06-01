import { createSignal, Show, onCleanup, onMount } from 'solid-js';
import { t } from '../i18n';

const [src, setSrc] = createSignal<string | null>(null);

export function openLightbox(s: string) {
  setSrc(s);
}

/// Mount once at the app root. Listens for clicks on any <img> inside
/// `.post-body` (we use event delegation since post HTML is injected
/// via innerHTML). Escape key closes.
export default function Lightbox() {
  onMount(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.tagName === 'IMG' && t.closest('.post-body')) {
        e.preventDefault();
        const img = t as HTMLImageElement;
        if (img.src) openLightbox(img.src);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSrc(null);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    });
  });

  return (
    <Show when={src()}>
      {(s) => (
        <div
          onClick={() => setSrc(null)}
          style="position: fixed; inset: 0; background: rgba(0, 0, 0, 0.92); display: flex; align-items: center; justify-content: center; z-index: 9998; cursor: zoom-out; padding: 20px;"
        >
          <img
            src={s()}
            alt=""
            style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: var(--radius); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);"
          />
          <button
            onClick={(e) => { e.stopPropagation(); setSrc(null); }}
            style="position: absolute; top: 16px; right: 16px; background: rgba(0,0,0,0.5); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 50%; width: 36px; height: 36px; font-size: 18px; cursor: pointer; padding: 0;"
            aria-label={t('lightbox.close')}
          >
            ✕
          </button>
        </div>
      )}
    </Show>
  );
}
