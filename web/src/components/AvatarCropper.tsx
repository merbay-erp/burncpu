import { createSignal, onMount, onCleanup } from 'solid-js';
import { t } from '../i18n';

const FRAME = 280; // on-screen crop circle, px
const OUT = 320; // exported square, px

// Pick-and-crop avatar: pan (drag) + zoom (slider) over a circular frame, then
// export the framed square to a JPEG blob. Keeps avatars consistent and lets
// users frame their face instead of uploading whatever aspect ratio.
export default function AvatarCropper(props: {
  file: File;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}) {
  const [url, setUrl] = createSignal('');
  const [nw, setNw] = createSignal(0);
  const [nh, setNh] = createSignal(0);
  const [minScale, setMinScale] = createSignal(1);
  const [scale, setScale] = createSignal(1);
  const [ox, setOx] = createSignal(0);
  const [oy, setOy] = createSignal(0);
  let imgEl: HTMLImageElement | undefined;
  let drag: { x: number; y: number; ox: number; oy: number } | null = null;

  onMount(() => {
    const u = URL.createObjectURL(props.file);
    setUrl(u);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onCancel(); };
    window.addEventListener('keydown', onKey);
    onCleanup(() => { URL.revokeObjectURL(u); window.removeEventListener('keydown', onKey); });
  });

  const dispW = () => nw() * scale();
  const dispH = () => nh() * scale();
  const imgLeft = () => (FRAME - dispW()) / 2 + ox();
  const imgTop = () => (FRAME - dispH()) / 2 + oy();

  const clamp = (x: number, y: number) => {
    const maxX = Math.max(0, (dispW() - FRAME) / 2);
    const maxY = Math.max(0, (dispH() - FRAME) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  };

  const onLoad = (e: Event) => {
    const img = e.currentTarget as HTMLImageElement;
    setNw(img.naturalWidth);
    setNh(img.naturalHeight);
    const cover = FRAME / Math.min(img.naturalWidth, img.naturalHeight);
    setMinScale(cover);
    setScale(cover);
    setOx(0);
    setOy(0);
  };

  const onDown = (e: PointerEvent) => {
    drag = { x: e.clientX, y: e.clientY, ox: ox(), oy: oy() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const c = clamp(drag.ox + (e.clientX - drag.x), drag.oy + (e.clientY - drag.y));
    setOx(c.x);
    setOy(c.y);
  };
  const onUp = () => { drag = null; };

  const onZoom = (v: number) => {
    const s = Math.max(minScale(), Math.min(minScale() * 4, v));
    setScale(s);
    const c = clamp(ox(), oy());
    setOx(c.x);
    setOy(c.y);
  };

  const apply = () => {
    if (!imgEl || !nw()) return;
    const s = scale();
    const srcX = -imgLeft() / s;
    const srcY = -imgTop() / s;
    const srcS = FRAME / s;
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(imgEl, srcX, srcY, srcS, srcS, 0, 0, OUT, OUT);
    canvas.toBlob((blob) => { if (blob) props.onCropped(blob); }, 'image/jpeg', 0.9);
  };

  return (
    <div
      class="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}
    >
      <div class="w-full max-w-[360px] bg-surface-container border border-outline-variant rounded-2xl p-5">
        <h3 class="text-on-background font-bold mb-4 flex items-center gap-2">
          <span class="material-symbols-outlined text-primary" style="font-size:20px;">crop</span>
          {t('settings.profile.crop_title')}
        </h3>
        <div
          class="mx-auto rounded-full overflow-hidden ring-2 ring-primary/40 bg-surface-container-lowest cursor-grab active:cursor-grabbing select-none"
          style={`position:relative;width:${FRAME}px;height:${FRAME}px;touch-action:none;`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <img
            ref={imgEl}
            src={url()}
            onLoad={onLoad}
            alt=""
            draggable={false}
            style={`position:absolute;left:${imgLeft()}px;top:${imgTop()}px;width:${dispW()}px;height:${dispH()}px;max-width:none;pointer-events:none;`}
          />
        </div>
        <div class="flex items-center gap-2 mt-4">
          <span class="material-symbols-outlined text-on-surface-variant" style="font-size:18px;">zoom_out</span>
          <input
            type="range"
            min={minScale()}
            max={minScale() * 4}
            step="0.001"
            value={scale()}
            onInput={(e) => onZoom(+e.currentTarget.value)}
            class="flex-1"
          />
          <span class="material-symbols-outlined text-on-surface-variant" style="font-size:18px;">zoom_in</span>
        </div>
        <div class="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={props.onCancel}
            class="px-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant font-mono text-[13px] hover:text-primary hover:border-primary/50 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={apply}
            class="px-5 py-2 rounded-lg bg-primary text-on-primary font-bold font-mono text-[13px] hover:opacity-90 active:scale-95 transition-all"
          >
            {t('settings.profile.crop_apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
