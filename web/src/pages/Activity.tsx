import { createResource, createSignal, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api } from '../api';
import { me } from '../auth';

interface Bucket {
  day: string;
  posts: number;
  reactions_received: number;
  replies_received: number;
  followers_gained: number;
}
interface Totals {
  posts: number;
  reactions_received: number;
  replies_received: number;
  followers_gained: number;
}
interface Activity {
  window: string;
  totals: Totals;
  daily: Bucket[];
}

const WIN: { value: string; label: string }[] = [
  { value: '7d', label: '7 gün' },
  { value: '30d', label: '30 gün' },
  { value: '90d', label: '90 gün' },
];

const METRICS: { key: keyof Totals; label: string; color: string }[] = [
  { key: 'posts',              label: 'Post',     color: 'var(--accent)' },
  { key: 'reactions_received', label: 'Tepki',    color: '#5fd068' },
  { key: 'replies_received',   label: 'Yanıt',    color: '#6cb7ff' },
  { key: 'followers_gained',   label: 'Yeni takipçi', color: '#f4b942' },
];

export default function ActivityPage() {
  const [window, setWindow] = createSignal('30d');
  const [data] = createResource<Activity | null, string>(
    window,
    async (w: string) => me() ? api.get<Activity>(`/users/me/activity?window=${w}`) : null,
  );

  return (
    <>
      <h2 class="page-title">
        Aktivite
        <small>
          <For each={WIN}>
            {(w) => (
              <button
                onClick={() => setWindow(w.value)}
                style={`background: transparent; border: none; padding: 0 6px; color: ${window() === w.value ? 'var(--accent)' : 'var(--fg-3)'}; cursor: pointer; font: inherit;`}
              >
                {w.label}
              </button>
            )}
          </For>
        </small>
      </h2>
      <Show when={me()} fallback={<p class="muted">Önce <A href="/login">giriş yap</A>.</p>}>
        <Show when={data()} fallback={<p class="muted">Yükleniyor…</p>}>
          {(d) => (
            <>
              <div
                style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 22px;"
              >
                <For each={METRICS}>
                  {(m) => (
                    <div style="padding: 12px; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius);">
                      <div class="tiny muted" style="text-transform: uppercase;">{m.label}</div>
                      <div style={`font-size: 24px; font-weight: 700; color: ${m.color}; margin-top: 4px;`}>
                        {d().totals[m.key]}
                      </div>
                    </div>
                  )}
                </For>
              </div>
              <h3>Günlük</h3>
              <For each={METRICS}>
                {(m) => <Spark label={m.label} color={m.color} buckets={d().daily} field={m.key} />}
              </For>
            </>
          )}
        </Show>
      </Show>
    </>
  );
}

/// Tiny inline SVG sparkline + per-day numbers underneath.
function Spark(props: {
  label: string;
  color: string;
  buckets: Bucket[];
  field: keyof Totals;
}) {
  const W = 600, H = 36;
  const values = () => props.buckets.map((b) => b[props.field] as number);
  const max = () => Math.max(1, ...values());
  const points = () => {
    const v = values();
    if (v.length === 0) return '';
    const step = W / Math.max(1, v.length - 1);
    return v
      .map((y, i) => `${(i * step).toFixed(1)},${(H - (y / max()) * H).toFixed(1)}`)
      .join(' ');
  };
  return (
    <div style="margin-bottom: 14px;">
      <div class="flex tiny muted" style="justify-content: space-between;">
        <span>{props.label}</span>
        <span>tepe: {max()}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style="width: 100%; height: 36px; display: block;">
        <polyline
          fill="none"
          stroke={props.color}
          stroke-width="1.5"
          points={points()}
        />
      </svg>
    </div>
  );
}
