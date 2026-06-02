import { createResource, createSignal, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api } from '../api';
import { me } from '../auth';
import { relTime } from '../util';
import { t } from '../i18n';

interface Stats {
  total_users: number;
  new_users_24h: number;
  dau_24h: number;
  total_posts: number;
  posts_24h: number;
  reactions_24h: number;
  follows_24h: number;
  requests_24h: number;
  errors_24h: number;
  flagged_sessions: number;
  pending_mod_posts: number;
  dm_messages_24h: number;
  media_total: number;
  media_bytes: number;
}

interface AdminPost {
  id: string;
  author_username: string;
  body: string;
  visibility: string;
  moderation_state: string;
  spam_score: number | null;
  reactions_count: number;
  replies_count: number;
  created_at: string;
  deleted_at: string | null;
}

interface AdminUserRow {
  id: string;
  username: string;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
  last_seen_at: string | null;
  post_count: number;
}

interface AuditRow {
  id: string;
  method: string;
  path: string;
  status: number;
  latency_ms: number;
  ip: string | null;
  user_agent: string | null;
  ts: string;
}

interface ReportRow {
  id: string;
  reporter_username: string;
  target_kind: string;
  target_id: string;
  reason: string;
  note: string | null;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

interface FedInstance {
  host: string;
  followers: number;
  blocked: boolean;
  reason: string | null;
}

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export default function Admin() {
  const [stats] = createResource<Stats>(() => api.get<Stats>('/admin/stats'));
  const [recent] = createResource<AdminPost[]>(() =>
    api.get<AdminPost[]>('/admin/posts?limit=10'),
  );
  const [users] = createResource<AdminUserRow[]>(() => api.get<AdminUserRow[]>('/admin/users'));
  const [errors] = createResource<AuditRow[]>(() =>
    api.get<AuditRow[]>('/admin/audit?status_min=400&limit=15'),
  );
  const [reports, { refetch: refetchReports }] = createResource<ReportRow[]>(() =>
    api.get<ReportRow[]>('/admin/reports?open=1'),
  );

  const resolve = async (id: string) => {
    const reso = prompt(t('admin.resolve_prompt'), 'no_action');
    if (!reso) return;
    if (!['no_action', 'removed', 'suspended', 'other'].includes(reso)) return;
    await api.patch(`/admin/reports/${id}`, { resolution: reso });
    refetchReports();
  };

  // Quarantine queue: new-account posts awaiting approval.
  const [pending, { refetch: refetchPending }] = createResource<AdminPost[]>(() =>
    api.get<AdminPost[]>('/admin/posts?state=quarantine&limit=50'),
  );
  const moderate = async (id: string, moderation_state: 'live' | 'removed') => {
    await api.patch(`/admin/posts/${id}`, { moderation_state });
    refetchPending();
  };

  const [instances, { refetch: refetchInstances }] = createResource<FedInstance[]>(() =>
    api.get<FedInstance[]>('/admin/federation/instances'),
  );
  const [blockHost, setBlockHost] = createSignal('');
  const [fedBusy, setFedBusy] = createSignal(false);
  const blockInstance = async (host: string, reason?: string) => {
    const h = host.trim();
    if (!h || fedBusy()) return;
    setFedBusy(true);
    try {
      await api.post('/admin/federation/blocks', { host: h, reason: reason || null });
      setBlockHost('');
      await refetchInstances();
    } finally {
      setFedBusy(false);
    }
  };
  const unblockInstance = async (host: string) => {
    if (fedBusy()) return;
    setFedBusy(true);
    try {
      await api.del(`/admin/federation/blocks/${encodeURIComponent(host)}`);
      await refetchInstances();
    } finally {
      setFedBusy(false);
    }
  };

  return (
    <>
      <h2 class="page-title">
        {t('admin.title')} <small>{t('admin.panel')}</small>
      </h2>
      <Show
        when={me()?.role === 'admin'}
        fallback={<p class="error">{t('admin.only')}</p>}
      >
        <Show when={stats()} fallback={<p class="muted">{t('loading')}</p>}>
          {(s) => (
            <div
              style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 24px;"
            >
              <Stat label={t('admin.stat.users')} value={s().total_users} sub={`+${s().new_users_24h} (24h)`} />
              <Stat label={t('admin.stat.dau')} value={s().dau_24h} />
              <Stat label={t('admin.stat.posts')} value={s().total_posts} sub={`+${s().posts_24h} (24h)`} />
              <Stat label={t('admin.stat.reactions')} value={s().reactions_24h} />
              <Stat label={t('admin.stat.follows')} value={s().follows_24h} />
              <Stat label={t('admin.stat.dm')} value={s().dm_messages_24h} />
              <Stat label={t('admin.stat.requests')} value={s().requests_24h} />
              <Stat
                label={t('admin.stat.errors')}
                value={s().errors_24h}
                tone={s().errors_24h > 0 ? 'bad' : 'ok'}
              />
              <Stat
                label={t('admin.stat.flagged')}
                value={s().flagged_sessions}
                tone={s().flagged_sessions > 0 ? 'warn' : 'ok'}
              />
              <Stat
                label={t('admin.stat.quarantine')}
                value={s().pending_mod_posts}
                tone={s().pending_mod_posts > 0 ? 'warn' : 'ok'}
              />
              <Stat label={t('admin.stat.media')} value={s().media_total} sub={fmtBytes(s().media_bytes)} />
            </div>
          )}
        </Show>

        <h3>{t('admin.open_reports')}</h3>
        <Show when={reports()} fallback={<p class="muted">…</p>}>
          {(rows) => (
            <For each={rows()} fallback={<p class="muted tiny">{t('admin.no_reports')}</p>}>
              {(r) => (
                <div
                  style="padding: 8px 0; border-bottom: 1px solid var(--border); display: flex; align-items: baseline; gap: 8px; font-size: 13px;"
                >
                  <span class="muted tiny">{relTime(r.created_at)}</span>
                  <strong>{r.reason}</strong>
                  <span class="tiny muted">{r.target_kind} {r.target_id.slice(0, 8)}</span>
                  <Show when={r.target_kind === 'post'}>
                    <A href={`/posts/${r.target_id}`} class="tiny">{t('admin.open')}</A>
                  </Show>
                  <span class="tiny muted" style="margin-left: auto;">
                    {t('admin.by')} <A href={`/u/${r.reporter_username}`}>@{r.reporter_username}</A>
                  </span>
                  <button class="ghost tiny" onClick={() => resolve(r.id)}>{t('admin.resolve')}</button>
                </div>
              )}
            </For>
          )}
        </Show>

        <h3 style="margin-top: 22px;">{t('admin.recent_errors')} (status ≥ 400)</h3>
        <Show when={errors()} fallback={<p class="muted">…</p>}>
          {(rows) => (
            <div style="font-size: 12px; font-family: var(--mono); margin-bottom: 22px;">
              <For each={rows()} fallback={<p class="muted">{t('admin.no_errors')} 🎉</p>}>
                {(r) => (
                  <div
                    style={`padding: 4px 0; border-bottom: 1px solid var(--border); color: ${r.status >= 500 ? 'var(--bad)' : 'var(--warn)'};`}
                  >
                    <span style="color: var(--fg-3);">{relTime(r.ts)}</span>{' '}
                    <strong>{r.status}</strong> {r.method} {r.path}{' '}
                    <span style="color: var(--fg-3);">{r.latency_ms}ms</span>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>

        <Show when={(pending()?.length ?? 0) > 0}>
          <h3>{t('admin.pending_review')}</h3>
          <div style="margin-bottom: 22px;">
            <For each={pending()}>
              {(p) => (
                <div style="padding: 8px 0; border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: baseline; font-size: 13px;">
                  <A href={`/u/${p.author_username}`} class="handle">@{p.author_username}</A>
                  <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{p.body.slice(0, 200)}</span>
                  <button class="ghost tiny" onClick={() => moderate(p.id, 'live')}>{t('admin.approve')}</button>
                  <button class="ghost tiny" onClick={() => moderate(p.id, 'removed')}>{t('admin.reject')}</button>
                </div>
              )}
            </For>
          </div>
        </Show>

        <h3 style="margin-top: 22px;">{t('admin.federation')}</h3>
        <p class="muted tiny" style="margin: -4px 0 10px;">{t('admin.fed_hint')}</p>
        <form
          style="display: flex; gap: 8px; margin-bottom: 12px;"
          onSubmit={(e) => {
            e.preventDefault();
            blockInstance(blockHost());
          }}
        >
          <input
            type="text"
            placeholder="spam.example"
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            value={blockHost()}
            onInput={(e) => setBlockHost(e.currentTarget.value)}
            style="flex: 1; min-width: 0;"
          />
          <button type="submit" class="primary" disabled={!blockHost().trim() || fedBusy()}>
            {t('admin.fed_block')}
          </button>
        </form>
        <Show when={instances()} fallback={<p class="muted">…</p>}>
          {(rows) => (
            <div style="margin-bottom: 22px;">
              <For each={rows()} fallback={<p class="muted tiny">{t('admin.fed_none')}</p>}>
                {(i) => (
                  <div style="padding: 8px 0; border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: baseline; font-size: 13px;">
                    <code style="font-size: 12px;">{i.host}</code>
                    <span class="tiny muted">{i.followers} {t('admin.fed_followers')}</span>
                    <Show when={i.blocked}>
                      <span class="tiny" style="color: var(--bad);">
                        {t('admin.fed_blocked')}{i.reason ? ` · ${i.reason}` : ''}
                      </span>
                    </Show>
                    <span style="margin-left: auto;" />
                    <Show
                      when={i.blocked}
                      fallback={
                        <button class="ghost tiny" disabled={fedBusy()} onClick={() => blockInstance(i.host)}>
                          {t('admin.fed_block')}
                        </button>
                      }
                    >
                      <button class="ghost tiny" disabled={fedBusy()} onClick={() => unblockInstance(i.host)}>
                        {t('admin.fed_unblock')}
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>

        <h3>{t('admin.recent_posts')}</h3>
        <Show when={recent()} fallback={<p class="muted">…</p>}>
          {(rows) => (
            <div style="margin-bottom: 22px;">
              <For each={rows()} fallback={<p class="muted">{t('admin.empty')}</p>}>
                {(p) => (
                  <div
                    style={`padding: 8px 0; border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: baseline; font-size: 13px;`}
                  >
                    <A href={`/u/${p.author_username}`} class="handle">@{p.author_username}</A>
                    <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                      {p.body.slice(0, 80)}
                    </span>
                    <span class="tiny muted">
                      {p.moderation_state}
                      {p.deleted_at ? ` · ${t('admin.deleted')}` : ''}
                    </span>
                    <A href={`/posts/${p.id}`} class="tiny">{t('admin.open')}</A>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>

        <h3>{t('admin.users')}</h3>
        <Show when={users()} fallback={<p class="muted">…</p>}>
          {(rows) => (
            <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
              <thead>
                <tr style="color: var(--fg-3);">
                  <th style="text-align: left; padding: 6px;">{t('admin.col.username')}</th>
                  <th style="text-align: left; padding: 6px;">{t('admin.col.email')}</th>
                  <th style="text-align: left; padding: 6px;">{t('admin.col.role')}</th>
                  <th style="text-align: right; padding: 6px;">{t('admin.col.posts')}</th>
                  <th style="text-align: right; padding: 6px;">{t('admin.col.last_seen')}</th>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(u) => (
                    <tr style="border-top: 1px solid var(--border);">
                      <td style="padding: 6px;">
                        <A href={`/u/${u.username}`}>@{u.username}</A>
                      </td>
                      <td style="padding: 6px; color: var(--fg-2); font-family: var(--mono); font-size: 12px;">
                        {u.email}
                      </td>
                      <td style={`padding: 6px; color: ${u.role === 'admin' ? 'var(--accent)' : u.role === 'suspended' ? 'var(--bad)' : 'var(--fg)'};`}>
                        {u.role}
                      </td>
                      <td style="padding: 6px; text-align: right;">{u.post_count}</td>
                      <td style="padding: 6px; text-align: right; color: var(--fg-3); font-size: 12px;">
                        {u.last_seen_at ? relTime(u.last_seen_at) : '—'}
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          )}
        </Show>
      </Show>
    </>
  );
}

function Stat(props: { label: string; value: number; sub?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const color =
    props.tone === 'bad' ? 'var(--bad)' :
    props.tone === 'warn' ? 'var(--warn)' :
    'var(--accent)';
  return (
    <div
      style="padding: 12px; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius);"
    >
      <div class="tiny muted" style="text-transform: uppercase; letter-spacing: 0.05em;">
        {props.label}
      </div>
      <div style={`font-size: 24px; font-weight: 700; color: ${color}; margin-top: 4px;`}>
        {props.value}
      </div>
      <Show when={props.sub}>
        <div class="tiny muted" style="margin-top: 2px;">{props.sub}</div>
      </Show>
    </div>
  );
}
