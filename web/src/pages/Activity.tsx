import { createResource, createSignal, For, Show } from 'solid-js';
import AuthGate from '../components/AuthGate';
import { api } from '../api';
import { me } from '../auth';
import { t } from '../i18n';

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

const WIN: { value: string; labelKey: string }[] = [
  { value: '7d', labelKey: 'window.7d' },
  { value: '30d', labelKey: 'window.30d' },
  { value: '90d', labelKey: 'window.90d' },
];

const METRICS: { key: keyof Totals; labelKey: string; color: string }[] = [
  { key: 'posts',              labelKey: 'activity.posts',              color: 'var(--accent)' },
  { key: 'reactions_received', labelKey: 'activity.reactions_received', color: '#5fd068' },
  { key: 'replies_received',   labelKey: 'activity.replies_received',   color: '#6cb7ff' },
  { key: 'followers_gained',   labelKey: 'activity.followers_gained',   color: '#f4b942' },
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
        {t('activity.title')}
        <small>
          <For each={WIN}>
            {(w) => (
              <button
                onClick={() => setWindow(w.value)}
                style={`background: transparent; border: none; padding: 0 6px; color: ${window() === w.value ? 'var(--accent)' : 'var(--fg-3)'}; cursor: pointer; font: inherit;`}
              >
                {t(w.labelKey)}
              </button>
            )}
          </For>
        </small>
      </h2>
      <Show when={me()} fallback={<AuthGate icon="monitoring" title={t('auth.gate.activity')} />}>
        <Show when={data()} fallback={<p class="muted">{t('common.loading')}</p>}>
          {(d) => (
            <>
              <div
                style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 22px;"
              >
                <For each={METRICS}>
                  {(m) => (
                    <div style="padding: 12px; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius);">
                      <div class="tiny muted" style="text-transform: uppercase;">{t(m.labelKey)}</div>
                      <div style={`font-size: 24px; font-weight: 700; color: ${m.color}; margin-top: 4px;`}>
                        {d().totals[m.key]}
                      </div>
                    </div>
                  )}
                </For>
              </div>
              <h3>{t('activity.daily')}</h3>
              <For each={METRICS}>
                {(m) => <Spark label={t(m.labelKey)} color={m.color} buckets={d().daily} field={m.key} />}
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
        <span>{t('activity.peak')} {max()}</span>
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
