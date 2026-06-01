import { createSignal, Show, For, createResource, onMount } from 'solid-js';
import QRCode from 'qrcode';
import { api, type Profile } from '../api';
import { me, setCachedMe } from '../auth';
import { locale, setLocale, t } from '../i18n';
import { theme, setTheme } from '../theme';
import { pushToast } from '../components/Toast';

type Tab = 'profile' | 'security' | 'invites' | 'dev';

const TAB_META: { id: Tab; icon: string; key: string }[] = [
  { id: 'profile', icon: 'person', key: 'settings.tab.profile' },
  { id: 'security', icon: 'security', key: 'settings.tab.security' },
  { id: 'invites', icon: 'mail', key: 'settings.tab.invites' },
  { id: 'dev', icon: 'code', key: 'settings.tab.dev' },
];

export default function Settings() {
  const [tab, setTab] = createSignal<Tab>('profile');

  return (
    <>
      <h1 class="font-headline-lg text-[26px] md:text-[28px] font-semibold tracking-tight text-on-background mb-5">
        {t('settings.title')}
      </h1>
      <Show
        when={me()}
        fallback={<p class="text-on-surface-variant">{t('settings.login_required')}</p>}
      >
        {/* Segmented tab control */}
        <div class="flex gap-1 p-1 bg-surface-container-low border border-outline-variant rounded-xl mb-6 overflow-x-auto">
          <For each={TAB_META}>
            {(tb) => (
              <button
                onClick={() => setTab(tb.id)}
                class={`flex items-center justify-center gap-2 flex-1 min-w-fit px-4 py-2 rounded-lg font-mono text-[13px] whitespace-nowrap transition-colors ${
                  tab() === tb.id
                    ? 'bg-primary text-on-primary font-bold'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                }`}
              >
                <span class="material-symbols-outlined" style="font-size:18px;">{tb.icon}</span>
                {t(tb.key)}
              </button>
            )}
          </For>
        </div>

        {/* Tab content (still uses the legacy form vocabulary) */}
        <div class="legacy">
          <Show when={tab() === 'profile'}><ProfileTab /></Show>
          <Show when={tab() === 'security'}><SecurityTab /></Show>
          <Show when={tab() === 'invites'}><InvitesTab /></Show>
          <Show when={tab() === 'dev'}><DevTab /></Show>
        </div>
      </Show>
    </>
  );
}

// ─── Developer (API tokens + webhooks) tab ──────────────────────

interface TokenRow {
  id: string; name: string; scope: string;
  last_used_at: string | null; expires_at: string | null;
  revoked_at: string | null; created_at: string;
}
interface CreatedToken { id: string; name: string; scope: string; token: string; expires_at: string | null; }
interface WebhookRow {
  id: string; url: string; events: string[]; active: boolean;
  last_called_at: string | null; last_status: number | null;
  failure_streak: number; created_at: string;
}
interface CreatedWebhook { id: string; url: string; events: string[]; secret: string; }

const TOKEN_SCOPES = [
  ['all', 'all (tam erişim)'],
  ['read', 'read (salt okuma)'],
  ['read:profile', 'read:profile'],
  ['write:profile', 'write:profile'],
  ['read:notifications', 'read:notifications'],
  ['write:notifications', 'write:notifications'],
  ['read:bookmarks', 'read:bookmarks'],
  ['write:bookmarks', 'write:bookmarks'],
  ['read:posts', 'read:posts'],
  ['write:posts', 'write:posts'],
  ['read:webhooks', 'read:webhooks'],
  ['write:webhooks', 'write:webhooks'],
  ['read:dm', 'read:dm'],
  ['write:dm', 'write:dm'],
  ['read:feed', 'read:feed'],
  ['write:feed', 'write:feed'],
  ['read:search', 'read:search'],
  ['write:search', 'write:search'],
  ['read:trending', 'read:trending'],
  ['write:trending', 'write:trending'],
  ['read:media', 'read:media'],
  ['write:media', 'write:media'],
  ['read:invites', 'read:invites'],
  ['write:invites', 'write:invites'],
  ['read:push', 'read:push'],
  ['write:push', 'write:push'],
];

function DevTab() {
  const [tokens, { refetch: refetchTokens }] = createResource<TokenRow[]>(() =>
    api.get<TokenRow[]>('/tokens'),
  );
  const [hooks, { refetch: refetchHooks }] = createResource<WebhookRow[]>(() =>
    api.get<WebhookRow[]>('/webhooks'),
  );

  const [tName, setTName] = createSignal('');
  const [tScope, setTScope] = createSignal('all');
  const [lastToken, setLastToken] = createSignal<CreatedToken | null>(null);

  const [hUrl, setHUrl] = createSignal('');
  const [hEvents, setHEvents] = createSignal<string[]>([]);
  const [lastHook, setLastHook] = createSignal<CreatedWebhook | null>(null);

  const createToken = async (e: Event) => {
    e.preventDefault();
    if (!tName().trim()) return;
    const r = await api.post<CreatedToken>('/tokens', { name: tName().trim(), scope: tScope() });
    setLastToken(r);
    setTName('');
    refetchTokens();
  };
  const revokeToken = async (id: string) => {
    if (!confirm(t('settings.dev.token_revoke_confirm'))) return;
    await api.del(`/tokens/${id}`);
    refetchTokens();
  };

  const toggleEvent = (ev: string) => {
    setHEvents((cur) => cur.includes(ev) ? cur.filter((x) => x !== ev) : [...cur, ev]);
  };
  const createHook = async (e: Event) => {
    e.preventDefault();
    if (!hUrl().trim() || hEvents().length === 0) return;
    try {
      const r = await api.post<CreatedWebhook>('/webhooks', {
        url: hUrl().trim(),
        events: hEvents(),
      });
      setLastHook(r);
      setHUrl('');
      setHEvents([]);
      refetchHooks();
    } catch (err) {
      pushToast((err as Error).message, 'warn');
    }
  };
  const toggleHookActive = async (h: WebhookRow) => {
    await api.patch(`/webhooks/${h.id}`, { active: !h.active });
    refetchHooks();
  };
  const removeHook = async (id: string) => {
    if (!confirm(t('settings.dev.webhook_remove_confirm'))) return;
    await api.del(`/webhooks/${id}`);
    refetchHooks();
  };

  const copy = (s: string) => void navigator.clipboard.writeText(s);

  return (
    <>
      <h3 style="margin-top: 0;">{t('settings.dev.tokens')}</h3>
      <p class="muted tiny" style="margin-top: 0;">
        {t('settings.dev.tokens_desc_pre')} <code>Authorization: Bearer &lt;token&gt;</code>
        {' '}{t('settings.dev.tokens_desc_post')}
      </p>
      <form onSubmit={createToken} class="flex" style="gap: 8px; flex-wrap: wrap;">
        <input
          type="text"
          maxlength="64"
          placeholder={t('settings.dev.token_name_placeholder')}
          value={tName()}
          onInput={(e) => setTName(e.currentTarget.value)}
          style="flex: 1; min-width: 200px;"
        />
        <select
          value={tScope()}
          onChange={(e) => setTScope(e.currentTarget.value)}
          style="background: var(--bg-2); border: 1px solid var(--border); padding: 8px; color: var(--fg); border-radius: var(--radius);"
        >
          <For each={TOKEN_SCOPES}>
            {([value, label]) => <option value={value}>{label}</option>}
          </For>
        </select>
        <button type="submit" class="primary" disabled={!tName().trim()}>{t('settings.dev.create')}</button>
      </form>

      <Show when={lastToken()}>
        {(tok) => (
          <div class="success" style="margin-top: 10px;">
            <p style="margin-top: 0;"><strong>{tok().name}</strong> {t('settings.dev.token_created_suffix')}</p>
            <code style="display: block; padding: 8px; background: var(--bg); border-radius: var(--radius); word-break: break-all; font-size: 12px;">
              {tok().token}
            </code>
            <button class="ghost tiny" onClick={() => copy(tok().token)} style="margin-top: 6px;">{t('settings.dev.copy')}</button>
          </div>
        )}
      </Show>

      <div style="margin-top: 16px;">
        <Show when={tokens()} fallback={<p class="muted">…</p>}>
          {(rows) => (
            <For each={rows()} fallback={<p class="muted tiny">{t('settings.dev.no_tokens')}</p>}>
              {(tok) => (
                <div
                  style={`display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); gap: 10px; font-size: 13px; opacity: ${tok.revoked_at ? '0.45' : '1'};`}
                >
                  <strong>{tok.name}</strong>
                  <span class="muted tiny">{tok.scope}</span>
                  <span class="muted tiny" style="margin-left: auto;">
                    {tok.revoked_at ? t('settings.dev.token_revoked') :
                      tok.last_used_at ? `${t('settings.dev.token_last_used')} ${new Date(tok.last_used_at).toLocaleString(locale() === 'en' ? 'en-US' : 'tr-TR')}` :
                      t('settings.dev.token_never_used')}
                  </span>
                  <Show when={!tok.revoked_at}>
                    <button class="ghost tiny" onClick={() => revokeToken(tok.id)}>{t('settings.dev.revoke')}</button>
                  </Show>
                </div>
              )}
            </For>
          )}
        </Show>
      </div>

      <h3 style="margin-top: 26px;">{t('settings.dev.webhooks')}</h3>
      <p class="muted tiny" style="margin-top: 0;">
        {t('settings.dev.webhooks_desc_pre')} <code>X-Burncpu-Signature: sha256=&lt;hex&gt;</code> {t('settings.dev.webhooks_desc_post')}
      </p>
      <form onSubmit={createHook}>
        <input
          type="url"
          placeholder="https://example.com/burncpu-hook"
          value={hUrl()}
          onInput={(e) => setHUrl(e.currentTarget.value)}
        />
        <div class="flex" style="margin-top: 10px; gap: 8px; flex-wrap: wrap;">
          <For each={['reaction', 'reply', 'follow', 'mention', 'dm']}>
            {(ev) => (
              <label
                style={`display: inline-flex; align-items: center; gap: 5px; margin: 0; padding: 6px 12px; border-radius: 999px; font-family: var(--mono); font-size: 12px; cursor: pointer; transition: all .15s; border: 1px solid ${hEvents().includes(ev) ? 'var(--accent)' : 'var(--border)'}; background: ${hEvents().includes(ev) ? 'rgba(156,225,109,0.12)' : 'transparent'}; color: ${hEvents().includes(ev) ? 'var(--accent)' : 'var(--fg-2)'};`}
              >
                <input
                  type="checkbox"
                  checked={hEvents().includes(ev)}
                  onChange={() => toggleEvent(ev)}
                  style="display: none;"
                />
                <span class="material-symbols-outlined" style="font-size: 15px;">
                  {hEvents().includes(ev) ? 'check_circle' : 'add_circle'}
                </span>
                {ev}
              </label>
            )}
          </For>
        </div>
        <div style="margin-top: 10px;">
          <button type="submit" class="primary" disabled={!hUrl().trim() || hEvents().length === 0}>
            {t('settings.dev.webhook_create')}
          </button>
        </div>
      </form>

      <Show when={lastHook()}>
        {(h) => (
          <div class="success" style="margin-top: 10px;">
            <p style="margin-top: 0;">
              <strong>{h().url}</strong> {t('settings.dev.webhook_created_pre')} <em>{t('settings.dev.webhook_created_em')}</em> {t('settings.dev.webhook_created_post')}
            </p>
            <code style="display: block; padding: 8px; background: var(--bg); border-radius: var(--radius); word-break: break-all; font-size: 12px;">
              {h().secret}
            </code>
            <button class="ghost tiny" onClick={() => copy(h().secret)} style="margin-top: 6px;">{t('settings.dev.copy')}</button>
          </div>
        )}
      </Show>

      <div style="margin-top: 16px;">
        <Show when={hooks()} fallback={<p class="muted">…</p>}>
          {(rows) => (
            <For each={rows()} fallback={<p class="muted tiny">{t('settings.dev.no_webhooks')}</p>}>
              {(h) => (
                <div
                  style={`padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; opacity: ${h.active ? '1' : '0.55'};`}
                >
                  <div class="flex" style="gap: 8px; flex-wrap: wrap; align-items: baseline;">
                    <code style="font-size: 12px;">{h.url}</code>
                    <span class="muted tiny">{h.events.join(', ')}</span>
                    <span style="margin-left: auto;" class="tiny muted">
                      {h.last_status ? `→ ${h.last_status}` : t('settings.dev.webhook_not_called')}{h.failure_streak > 0 ? ` (${h.failure_streak} ${t('settings.dev.webhook_errors')})` : ''}
                    </span>
                    <button class="ghost tiny" onClick={() => toggleHookActive(h)}>
                      {h.active ? t('settings.dev.webhook_stop') : t('settings.dev.webhook_activate')}
                    </button>
                    <button class="ghost tiny" onClick={() => removeHook(h.id)}>{t('settings.dev.webhook_delete')}</button>
                  </div>
                </div>
              )}
            </For>
          )}
        </Show>
      </div>
    </>
  );
}

// ─── Profile tab ────────────────────────────────────────────────

function ProfileTab() {
  const u = me()!;
  const [displayName, setDisplayName] = createSignal('');
  const [bio, setBio] = createSignal('');
  const [avatarUrl, setAvatarUrl] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [msg, setMsg] = createSignal<{ kind: 'ok' | 'err'; text: string } | null>(null);
  let fileInput: HTMLInputElement | undefined;

  const pickAvatar = () => fileInput?.click();
  const onAvatarFile = async (e: Event) => {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch('/api/v1/media', {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? `HTTP ${r.status}`);
      }
      const m = (await r.json()) as { url: string };
      setAvatarUrl(`${window.location.origin}${m.url}`);
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setUploading(false);
      if (fileInput) fileInput.value = '';
    }
  };

  onMount(async () => {
    try {
      const p = await api.get<Profile>(`/users/${u.username}`);
      setDisplayName(p.display_name);
      setBio(p.bio ?? '');
      setAvatarUrl(p.avatar_url ?? '');
    } catch {
      // ignore
    }
  });

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.patch('/users/me', {
        display_name: displayName().trim(),
        bio: bio(),
        avatar_url: avatarUrl().trim(),
      });
      setCachedMe({ ...u, display_name: displayName().trim(), avatar_url: avatarUrl().trim() || null });
      setMsg({ kind: 'ok', text: t('settings.profile.saved') });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} style="max-width: 520px;">
      <label class="muted tiny">{t('settings.profile.username')}</label>
      <input type="text" value={u.username} disabled />
      <label class="muted tiny" style="margin-top: 12px; display:block;">{t('settings.profile.name')}</label>
      <input
        type="text"
        maxlength="80"
        value={displayName()}
        onInput={(e) => setDisplayName(e.currentTarget.value)}
      />
      <label class="muted tiny" style="margin-top: 12px; display:block;">{t('settings.profile.bio')}</label>
      <textarea
        maxlength="280"
        value={bio()}
        onInput={(e) => setBio(e.currentTarget.value)}
        rows="3"
      />
      <label class="muted tiny" style="margin-top: 12px; display:block;">{t('settings.profile.avatar')}</label>
      <Show when={avatarUrl()}>
        <img
          src={avatarUrl()}
          alt=""
          style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; margin-bottom: 8px; background: var(--bg-3);"
        />
      </Show>
      <div class="flex">
        <input
          type="url"
          placeholder="https://..."
          value={avatarUrl()}
          onInput={(e) => setAvatarUrl(e.currentTarget.value)}
          style="flex: 1;"
        />
        <button type="button" class="ghost tiny" onClick={pickAvatar} disabled={uploading()}>
          {uploading() ? t('common.loading') : `📷 ${t('settings.profile.upload')}`}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          style="display: none;"
          onChange={onAvatarFile}
        />
      </div>
      <Show when={msg()}>
        {(m) => <div class={m().kind === 'ok' ? 'success' : 'error'}>{m().text}</div>}
      </Show>
      <div style="margin-top: 18px;">
        <button type="submit" class="primary" disabled={busy()}>
          {busy() ? t('settings.profile.saving') : t('settings.profile.save')}
        </button>
      </div>
      <PrefsBlock />
      <ExportBlock />
      <DangerZone />
    </form>
  );
}

function PrefsBlock() {
  return (
    <div style="margin-top: 30px; padding-top: 18px; border-top: 1px solid var(--border);">
      <h3 style="margin: 0 0 10px;">{t('settings.prefs.language')}</h3>
      <div class="flex">
        <button
          type="button"
          class={locale() === 'tr' ? 'primary' : ''}
          onClick={() => setLocale('tr')}
        >
          Türkçe
        </button>
        <button
          type="button"
          class={locale() === 'en' ? 'primary' : ''}
          onClick={() => setLocale('en')}
        >
          English
        </button>
      </div>

      <h3 style="margin: 18px 0 10px;">{t('settings.prefs.theme')}</h3>
      <div class="flex">
        <button
          type="button"
          class={theme() === 'dark' ? 'primary' : ''}
          onClick={() => setTheme('dark')}
        >
          🌙 {t('theme.dark')}
        </button>
        <button
          type="button"
          class={theme() === 'light' ? 'primary' : ''}
          onClick={() => setTheme('light')}
        >
          ☀️ {t('theme.light')}
        </button>
      </div>
      {/* PushBlock hidden during high-signal pact — dopamine-pull UX.
          sw.js handler stays dormant; render <PushBlock /> to bring back. */}
    </div>
  );
}

// @ts-expect-error — preserved for high-signal pact unwind; render <PushBlock/>
// inside PrefsBlock to bring back the Web Push subscribe toggle.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function PushBlock() {
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const [perm, setPerm] = createSignal<NotificationPermission>(supported ? Notification.permission : 'default');
  const [enabled, setEnabled] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  onMount(async () => {
    if (!supported) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setEnabled(!!sub);
    } catch (_) { /* ignore */ }
  });

  const urlB64ToUint8Array = (s: string): Uint8Array => {
    const padding = '='.repeat((4 - (s.length % 4)) % 4);
    const base64 = (s + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };

  const enable = async () => {
    if (!supported) return;
    setBusy(true);
    setErr(null);
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== 'granted') {
        setErr('izin verilmedi');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const r = await fetch('/api/v1/push/vapid-public-key');
      const pubKey = (await r.text()).trim();
      if (!pubKey) {
        setErr('Sunucu VAPID anahtarı ayarlanmamış — yöneticiyle konuş.');
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(pubKey),
      });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await fetch('/api/v1/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      setEnabled(true);
    } catch (e) {
      setErr((e as Error).message || 'push abone hatası');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!supported) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/v1/push/unsubscribe', {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setEnabled(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style="margin-top: 22px;">
      <h3 style="margin: 0 0 6px;">Tarayıcı bildirimleri</h3>
      <Show
        when={supported}
        fallback={<p class="muted tiny">Tarayıcın Web Push desteklemiyor.</p>}
      >
        <Show when={perm() === 'denied'}>
          <div class="error">İzin reddedildi. Tarayıcı ayarlarından site iznini açman gerek.</div>
        </Show>
        <Show when={err()}>
          <div class="error">{err()}</div>
        </Show>
        <div class="flex">
          <Show
            when={enabled()}
            fallback={
              <button class="primary" onClick={enable} disabled={busy() || perm() === 'denied'}>
                {busy() ? 'Bağlanıyor…' : 'Açık'}
              </button>
            }
          >
            <button onClick={disable} disabled={busy()}>
              {busy() ? 'Kapatılıyor…' : 'Kapat'}
            </button>
            <span class="tiny muted">Aktif</span>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function ExportBlock() {
  const download = (e: Event) => {
    e.preventDefault();
    window.location.assign('/api/v1/users/me/export');
  };
  return (
    <div style="margin-top: 18px;">
      <h3 style="margin: 0 0 6px;">{t('settings.export.title')}</h3>
      <p class="muted tiny" style="margin-top: 0;">
        {t('settings.export.desc_pre')} "burncpu-export-YYYY-MM-DD.json" {t('settings.export.desc_post')}
      </p>
      <button type="button" onClick={download}>{t('settings.export.download')}</button>
    </div>
  );
}

function DangerZone() {
  const u = me()!;
  const [open, setOpen] = createSignal(false);
  const [confirm, setConfirm] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  const wipe = async () => {
    if (confirm() !== u.username) {
      setErr(`${t('settings.danger.confirm_prefix')} '${u.username}' ${t('settings.danger.confirm_suffix')}`);
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/v1/users/me', {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          Origin: window.location.origin,
          'X-Confirm-Username': u.username,
        },
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? `HTTP ${r.status}`);
      }
      localStorage.clear();
      window.location.assign('/');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style="margin-top: 40px; padding: 14px; border: 1px solid rgba(255, 92, 92, 0.4); border-radius: var(--radius); background: rgba(255, 92, 92, 0.04);"
    >
      <h3 style="margin: 0 0 6px; color: var(--bad);">{t('settings.danger.title')}</h3>
      <p class="muted tiny" style="margin-top: 0;">
        {t('settings.danger.desc')}
      </p>
      <Show when={!open()} fallback={
        <div style="margin-top: 8px;">
          <p class="tiny">{t('settings.danger.confirm_label')} <code>{u.username}</code></p>
          <input
            type="text"
            value={confirm()}
            onInput={(e) => setConfirm(e.currentTarget.value)}
            placeholder={u.username}
          />
          <Show when={err()}>
            <div class="error">{err()}</div>
          </Show>
          <div class="flex" style="margin-top: 8px; gap: 8px;">
            <button onClick={() => { setOpen(false); setConfirm(''); setErr(null); }} disabled={busy()}>
              {t('common.cancel')}
            </button>
            <button
              onClick={wipe}
              disabled={busy() || confirm() !== u.username}
              style="background: var(--bad); color: white; border-color: var(--bad);"
            >
              {busy() ? t('settings.danger.deleting') : t('settings.danger.delete_confirm')}
            </button>
          </div>
        </div>
      }>
        <button onClick={() => setOpen(true)} style="color: var(--bad);">
          {t('settings.danger.open')}
        </button>
      </Show>
    </div>
  );
}

// ─── Security (2FA) tab ─────────────────────────────────────────

interface TwoFaStatus {
  enrolled: boolean;
  confirmed: boolean;
  recovery_codes_remaining: number;
}

interface EnrollResponse {
  otpauth_uri: string;
  secret_base32: string;
  recovery_codes: string[];
}

function SecurityTab() {
  const [status, { refetch }] = createResource<TwoFaStatus>(() =>
    api.get<TwoFaStatus>('/auth/2fa/status'),
  );
  const [enroll, setEnroll] = createSignal<EnrollResponse | null>(null);
  const [qrSvg, setQrSvg] = createSignal('');
  const [code, setCode] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  const startEnroll = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<EnrollResponse>('/auth/2fa/enroll');
      setEnroll(r);
      const svg = await QRCode.toString(r.otpauth_uri, {
        type: 'svg',
        margin: 1,
        color: { dark: '#ff6b35', light: '#0b0b0c' },
      });
      setQrSvg(svg);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/auth/2fa/confirm', { code: code().trim() });
      setEnroll(null);
      setQrSvg('');
      setCode('');
      refetch();
    } catch (e) {
      setErr((e as Error).message || t('settings.2fa.err_code_rejected'));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    const c = prompt(t('settings.2fa.disable_prompt'));
    if (!c) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post('/auth/2fa/disable', { code: c.trim() });
      refetch();
    } catch (e) {
      setErr((e as Error).message || t('settings.2fa.err_code_wrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 style="margin: 0 0 8px;">{t('settings.2fa.title')}</h3>
      <p class="muted tiny" style="margin-top: 0;">
        {t('settings.2fa.desc')}
      </p>

      <Show when={status.loading}>
        <p class="muted">{t('common.loading')}</p>
      </Show>

      <Show when={status() && !enroll() ? status() : null}>
        {(s) => (
          <>
            <Show when={s().confirmed}>
              <div class="success">
                {t('settings.2fa.active_prefix')} {s().recovery_codes_remaining}/10.
              </div>
              <button onClick={disable} disabled={busy()}>
                {t('settings.2fa.disable')}
              </button>
            </Show>
            <Show when={s().enrolled && !s().confirmed}>
              <div class="error">
                {t('settings.2fa.unconfirmed')}
              </div>
              <button class="primary" onClick={startEnroll} disabled={busy()}>
                {t('settings.2fa.restart')}
              </button>
            </Show>
            <Show when={!s().enrolled}>
              <button class="primary" onClick={startEnroll} disabled={busy()}>
                {busy() ? t('settings.2fa.preparing') : t('settings.2fa.setup')}
              </button>
            </Show>
          </>
        )}
      </Show>

      <Show when={enroll()}>
        {(e) => (
          <div style="margin-top: 18px; padding: 14px; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius);">
            <h4 style="margin-top: 0;">{t('settings.2fa.step1')}</h4>
            <div style="display: flex; gap: 18px; flex-wrap: wrap;">
              <div style="background: var(--bg); padding: 8px; border-radius: var(--radius); max-width: 200px;" innerHTML={qrSvg()} />
              <div style="flex: 1; min-width: 220px;">
                <p class="muted tiny" style="margin-top: 0;">
                  {t('settings.2fa.manual_entry')}
                </p>
                <code style="display: block; padding: 6px 8px; word-break: break-all; font-size: 12px;">
                  {e().secret_base32}
                </code>
                <h4>{t('settings.2fa.step2')}</h4>
                <p class="error tiny">{t('settings.2fa.recovery_warn')}</p>
                <pre style="white-space: pre-wrap; line-height: 1.7; font-size: 12px;">
                  {e().recovery_codes.join('  ')}
                </pre>
                <h4>{t('settings.2fa.step3')}</h4>
                <form onSubmit={confirm}>
                  <input
                    type="text"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    placeholder="123456"
                    value={code()}
                    onInput={(ev) => setCode(ev.currentTarget.value)}
                    autofocus
                  />
                  <Show when={err()}>
                    <div class="error">{err()}</div>
                  </Show>
                  <div style="margin-top: 10px;">
                    <button type="submit" class="primary" disabled={busy() || !code()}>
                      {busy() ? t('settings.2fa.verifying') : t('settings.2fa.activate')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </Show>
      <Show when={err() && !enroll()}>
        <div class="error">{err()}</div>
      </Show>
    </>
  );
}

// ─── Invites tab ────────────────────────────────────────────────

interface Invite {
  code: string;
  expires_at: string;
  created_at: string;
  redeemed_at: string | null;
  redeemed_by: string | null;
}

interface InviteCreated {
  code: string;
  url: string;
  expires_at: string;
}

function InvitesTab() {
  const [data, { refetch }] = createResource<Invite[]>(() => api.get<Invite[]>('/invites'));
  const [busy, setBusy] = createSignal(false);
  const [last, setLast] = createSignal<InviteCreated | null>(null);
  const [err, setErr] = createSignal<string | null>(null);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<InviteCreated>('/invites');
      setLast(r);
      refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (code: string) => {
    if (!confirm(`${code} ${t('settings.invites.revoke_confirm_suffix')}`)) return;
    await api.del(`/invites/${code}`);
    refetch();
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  return (
    <>
      <p class="muted tiny">
        {t('settings.invites.intro')}
      </p>
      <button class="primary" onClick={create} disabled={busy()}>
        {busy() ? t('settings.invites.creating') : t('settings.invites.new')}
      </button>
      <Show when={err()}>
        <div class="error">{err()}</div>
      </Show>
      <Show when={last()}>
        {(l) => (
          <div class="success" style="margin-top: 12px;">
            <strong>{l().code}</strong>
            <div class="tiny" style="margin-top: 4px;">
              <button class="ghost tiny" onClick={() => copy(l().url)}>
                {t('settings.invites.copy_url')}
              </button>
              <button class="ghost tiny" onClick={() => copy(l().code)} style="margin-left: 6px;">
                {t('settings.invites.copy_code')}
              </button>
            </div>
          </div>
        )}
      </Show>

      <h3 style="margin-top: 22px;">{t('settings.invites.your_invites')}</h3>
      <Show when={data()} fallback={<p class="muted">{t('common.loading')}</p>}>
        {(list) => (
          <For each={list()} fallback={<p class="muted">{t('settings.invites.empty')}</p>}>
            {(inv) => (
              <div
                style="display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 13px;"
              >
                <code style="font-size: 13px;">{inv.code}</code>
                <span class="tiny muted">
                  {inv.redeemed_at
                    ? `✓ ${t('settings.invites.redeemed')} ${relDate(inv.redeemed_at)}`
                    : Date.parse(inv.expires_at) < Date.now()
                      ? `⊘ ${t('settings.invites.expired')}`
                      : `${t('settings.invites.valid_until_prefix')} ${new Date(inv.expires_at).toLocaleDateString(locale() === 'en' ? 'en-US' : 'tr-TR')})`}
                </span>
                <Show when={!inv.redeemed_at && Date.parse(inv.expires_at) > Date.now()}>
                  <button class="ghost tiny" style="margin-left: auto;" onClick={() => revoke(inv.code)}>
                    {t('settings.invites.revoke')}
                  </button>
                </Show>
              </div>
            )}
          </For>
        )}
      </Show>
    </>
  );
}

function relDate(iso: string) {
  return new Date(iso).toLocaleDateString(locale() === 'en' ? 'en-US' : 'tr-TR', {
    day: 'numeric',
    month: 'short',
  });
}
