import { createSignal, For, Show } from 'solid-js';

/// Tiny imperative toast queue. Anywhere in the SPA can `pushToast(...)`.
/// Auto-dismisses after `ttlMs` (default 4500). Stacks bottom-right.

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'ok' | 'warn';
}

const [toasts, setToasts] = createSignal<Toast[]>([]);
let nextId = 1;

export function pushToast(text: string, kind: Toast['kind'] = 'info', ttlMs = 4500) {
  const id = nextId++;
  setToasts((cur) => [...cur, { id, text, kind }]);
  setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), ttlMs);
}

export default function ToastStack() {
  return (
    <Show when={toasts().length > 0}>
      <div
        style="position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 9999; max-width: 360px;"
      >
        <For each={toasts()}>
          {(t) => (
            <div
              style={`background: var(--bg-3); border: 1px solid var(--border); border-left: 3px solid ${
                t.kind === 'ok'
                  ? 'var(--ok)'
                  : t.kind === 'warn'
                    ? 'var(--warn)'
                    : 'var(--accent)'
              }; border-radius: var(--radius); padding: 10px 14px; font-size: 13px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4); cursor: pointer;`}
              onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
            >
              {t.text}
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
