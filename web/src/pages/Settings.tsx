import { createSignal, Show, For, createResource, onMount } from 'solid-js';
import QRCode from 'qrcode';
import { api, type Profile } from '../api';
import { me, setCachedMe } from '../auth';
import { locale, setLocale } from '../i18n';
import { pushToast } from '../components/Toast';

type Tab = 'profile' | 'security' | 'invites' | 'dev';

export default function Settings() {
  const [tab, setTab] = createSignal<Tab>('profile');

  return (
    <>
      <h2 class="page-title">Ayarlar</h2>
      <Show when={me()} fallback={<p class="muted">Önce giriş yap.</p>}>
        <div class="flex" style="border-bottom: 1px solid var(--border); margin-bottom: 16px; gap: 4px;">
          <TabBtn label="Profil" active={tab() === 'profile'} onClick={() => setTab('profile')} />
          <TabBtn label="Güvenlik" active={tab() === 'security'} onClick={() => setTab('security')} />
          <TabBtn label="Davetler" active={tab() === 'invites'} onClick={() => setTab('invites')} />
          <TabBtn label="Geliştirici" active={tab() === 'dev'} onClick={() => setTab('dev')} />
        </div>
        <Show when={tab() === 'profile'}>
          <ProfileTab />
        </Show>
        <Show when={tab() === 'security'}>
          <SecurityTab />
        </Show>
        <Show when={tab() === 'invites'}>
          <InvitesTab />
        </Show>
        <Show when={tab() === 'dev'}>
          <DevTab />
        </Show>
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
    if (!confirm('Token iptal edilsin mi?')) return;
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
    if (!confirm('Webhook silinsin mi?')) return;
    await api.del(`/webhooks/${id}`);
    refetchHooks();
  };

  const copy = (s: string) => void navigator.clipboard.writeText(s);

  return (
    <>
      <h3 style="margin-top: 0;">API Tokens</h3>
      <p class="muted tiny" style="margin-top: 0;">
        Bot ve script'lerden API'yi çağırmak için. <code>Authorization: Bearer &lt;token&gt;</code>
        header'ı her endpoint'te çalışır.
      </p>
      <form onSubmit={createToken} class="flex" style="gap: 8px; flex-wrap: wrap;">
        <input
          type="text"
          maxlength="64"
          placeholder="token adı (örn: macbook-cli)"
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
        <button type="submit" class="primary" disabled={!tName().trim()}>Oluştur</button>
      </form>

      <Show when={lastToken()}>
        {(t) => (
          <div class="success" style="margin-top: 10px;">
            <p style="margin-top: 0;"><strong>{t().name}</strong> oluşturuldu. Bu token sadece bir kez gösterilir, kaydet:</p>
            <code style="display: block; padding: 8px; background: var(--bg); border-radius: var(--radius); word-break: break-all; font-size: 12px;">
              {t().token}
            </code>
            <button class="ghost tiny" onClick={() => copy(t().token)} style="margin-top: 6px;">Kopyala</button>
          </div>
        )}
      </Show>

      <div style="margin-top: 16px;">
        <Show when={tokens()} fallback={<p class="muted">…</p>}>
          {(rows) => (
            <For each={rows()} fallback={<p class="muted tiny">Henüz token yok.</p>}>
              {(t) => (
                <div
                  style={`display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); gap: 10px; font-size: 13px; opacity: ${t.revoked_at ? '0.45' : '1'};`}
                >
                  <strong>{t.name}</strong>
                  <span class="muted tiny">{t.scope}</span>
                  <span class="muted tiny" style="margin-left: auto;">
                    {t.revoked_at ? 'iptal edildi' :
                      t.last_used_at ? `son: ${new Date(t.last_used_at).toLocaleString('tr-TR')}` :
                      'hiç kullanılmadı'}
                  </span>
                  <Show when={!t.revoked_at}>
                    <button class="ghost tiny" onClick={() => revokeToken(t.id)}>iptal</button>
                  </Show>
                </div>
              )}
            </For>
          )}
        </Show>
      </div>

      <h3 style="margin-top: 26px;">Webhook'lar</h3>
      <p class="muted tiny" style="margin-top: 0;">
        Olay olduğunda burncpu sana POST atar. HMAC-SHA256 imzası <code>X-Burncpu-Signature: sha256=&lt;hex&gt;</code> header'ında.
      </p>
      <form onSubmit={createHook}>
        <input
          type="url"
          placeholder="https://example.com/burncpu-hook"
          value={hUrl()}
          onInput={(e) => setHUrl(e.currentTarget.value)}
        />
        <div class="flex" style="margin-top: 8px; gap: 8px; flex-wrap: wrap;">
          <For each={['reaction', 'reply', 'follow', 'mention', 'dm']}>
            {(ev) => (
              <label
                class="flex tiny"
                style={`gap: 4px; padding: 4px 8px; border: 1px solid var(--border); border-radius: 999px; background: ${hEvents().includes(ev) ? 'var(--bg-3)' : 'transparent'}; color: ${hEvents().includes(ev) ? 'var(--accent)' : 'var(--fg)'}; cursor: pointer;`}
              >
                <input
                  type="checkbox"
                  checked={hEvents().includes(ev)}
                  onChange={() => toggleEvent(ev)}
                  style="margin: 0;"
                />
                {ev}
              </label>
            )}
          </For>
        </div>
        <div style="margin-top: 10px;">
          <button type="submit" class="primary" disabled={!hUrl().trim() || hEvents().length === 0}>
            Webhook oluştur
          </button>
        </div>
      </form>

      <Show when={lastHook()}>
        {(h) => (
          <div class="success" style="margin-top: 10px;">
            <p style="margin-top: 0;">
              <strong>{h().url}</strong> kaydedildi. İmza secret'in <em>sadece bir kez</em> gösterilir:
            </p>
            <code style="display: block; padding: 8px; background: var(--bg); border-radius: var(--radius); word-break: break-all; font-size: 12px;">
              {h().secret}
            </code>
            <button class="ghost tiny" onClick={() => copy(h().secret)} style="margin-top: 6px;">Kopyala</button>
          </div>
        )}
      </Show>

      <div style="margin-top: 16px;">
        <Show when={hooks()} fallback={<p class="muted">…</p>}>
          {(rows) => (
            <For each={rows()} fallback={<p class="muted tiny">Henüz webhook yok.</p>}>
              {(h) => (
                <div
                  style={`padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; opacity: ${h.active ? '1' : '0.55'};`}
                >
                  <div class="flex" style="gap: 8px; flex-wrap: wrap; align-items: baseline;">
                    <code style="font-size: 12px;">{h.url}</code>
                    <span class="muted tiny">{h.events.join(', ')}</span>
                    <span style="margin-left: auto;" class="tiny muted">
                      {h.last_status ? `→ ${h.last_status}` : 'çağrılmadı'}{h.failure_streak > 0 ? ` (${h.failure_streak} hata)` : ''}
                    </span>
                    <button class="ghost tiny" onClick={() => toggleHookActive(h)}>
                      {h.active ? 'durdur' : 'aktive et'}
                    </button>
                    <button class="ghost tiny" onClick={() => removeHook(h.id)}>sil</button>
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

function TabBtn(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      style={`background: transparent; border: none; border-bottom: 2px solid ${
        props.active ? 'var(--accent)' : 'transparent'
      }; border-radius: 0; color: ${props.active ? 'var(--accent)' : 'var(--fg-2)'}; padding: 8px 14px; font-weight: ${props.active ? '600' : '400'};`}
    >
      {props.label}
    </button>
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
      setCachedMe({ ...u, display_name: displayName().trim() });
      setMsg({ kind: 'ok', text: 'Kaydedildi.' });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} style="max-width: 520px;">
      <label class="muted tiny">Kullanıcı adı</label>
      <input type="text" value={u.username} disabled />
      <label class="muted tiny" style="margin-top: 12px; display:block;">İsim</label>
      <input
        type="text"
        maxlength="80"
        value={displayName()}
        onInput={(e) => setDisplayName(e.currentTarget.value)}
      />
      <label class="muted tiny" style="margin-top: 12px; display:block;">Bio (max 280)</label>
      <textarea
        maxlength="280"
        value={bio()}
        onInput={(e) => setBio(e.currentTarget.value)}
        rows="3"
      />
      <label class="muted tiny" style="margin-top: 12px; display:block;">Avatar</label>
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
          {uploading() ? 'Yükleniyor…' : '📷 Yükle'}
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
          {busy() ? 'Kaydediliyor…' : 'Kaydet'}
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
      <h3 style="margin: 0 0 10px;">Dil / Language</h3>
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
      <h3 style="margin: 0 0 6px;">Verini indir</h3>
      <p class="muted tiny" style="margin-top: 0;">
        Profil, postlar, takipler, tepkiler, kayıtlılar ve medya bilgilerinin
        JSON dökümü. Tarayıcın "burncpu-export-YYYY-MM-DD.json" olarak kaydeder.
      </p>
      <button type="button" onClick={download}>JSON indir</button>
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
      setErr(`Onay için '${u.username}' yaz`);
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
      <h3 style="margin: 0 0 6px; color: var(--bad);">Tehlikeli bölge</h3>
      <p class="muted tiny" style="margin-top: 0;">
        Hesabı silmek; postların, mesajların, oturumların, davetlerin — her şeyin geri
        dönüşsüz silinmesi demek. Admin hesabı silinemez.
      </p>
      <Show when={!open()} fallback={
        <div style="margin-top: 8px;">
          <p class="tiny">Onaylamak için kullanıcı adını yaz: <code>{u.username}</code></p>
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
              Vazgeç
            </button>
            <button
              onClick={wipe}
              disabled={busy() || confirm() !== u.username}
              style="background: var(--bad); color: white; border-color: var(--bad);"
            >
              {busy() ? 'Siliniyor…' : 'Hesabımı geri dönüşsüz sil'}
            </button>
          </div>
        </div>
      }>
        <button onClick={() => setOpen(true)} style="color: var(--bad);">
          Hesabımı sil…
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
      setErr((e as Error).message || 'kod kabul edilmedi');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    const c = prompt('Devre dışı bırakmak için authenticator kodunu gir:');
    if (!c) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post('/auth/2fa/disable', { code: c.trim() });
      refetch();
    } catch (e) {
      setErr((e as Error).message || 'kod yanlış');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 style="margin: 0 0 8px;">İki faktörlü kimlik doğrulama (TOTP)</h3>
      <p class="muted tiny" style="margin-top: 0;">
        Magic-link'e ek olarak authenticator app'ten 6 haneli kod gerektir. Admin
        endpoint'leri 2FA olmadan sana açılmaz.
      </p>

      <Show when={status.loading}>
        <p class="muted">Yükleniyor…</p>
      </Show>

      <Show when={status() && !enroll() ? status() : null}>
        {(s) => (
          <>
            <Show when={s().confirmed}>
              <div class="success">
                ✓ Aktif. Recovery kodu kalan: {s().recovery_codes_remaining}/10.
              </div>
              <button onClick={disable} disabled={busy()}>
                2FA'yı kapat
              </button>
            </Show>
            <Show when={s().enrolled && !s().confirmed}>
              <div class="error">
                Enrollment başlatılmış ama onaylanmamış. Yeniden başlat:
              </div>
              <button class="primary" onClick={startEnroll} disabled={busy()}>
                Tekrar başlat
              </button>
            </Show>
            <Show when={!s().enrolled}>
              <button class="primary" onClick={startEnroll} disabled={busy()}>
                {busy() ? 'Hazırlanıyor…' : '2FA kur'}
              </button>
            </Show>
          </>
        )}
      </Show>

      <Show when={enroll()}>
        {(e) => (
          <div style="margin-top: 18px; padding: 14px; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius);">
            <h4 style="margin-top: 0;">1. QR kodu authenticator uygulamana tara</h4>
            <div style="display: flex; gap: 18px; flex-wrap: wrap;">
              <div style="background: var(--bg); padding: 8px; border-radius: var(--radius); max-width: 200px;" innerHTML={qrSvg()} />
              <div style="flex: 1; min-width: 220px;">
                <p class="muted tiny" style="margin-top: 0;">
                  Tarayamıyorsan elle gir:
                </p>
                <code style="display: block; padding: 6px 8px; word-break: break-all; font-size: 12px;">
                  {e().secret_base32}
                </code>
                <h4>2. Recovery kodlarını güvenli bir yere kaydet</h4>
                <p class="error tiny">Bu kodlar sadece BIR KEZ gösterilir. Authenticator'ı kaybedersen tek erişimin bunlar.</p>
                <pre style="white-space: pre-wrap; line-height: 1.7; font-size: 12px;">
                  {e().recovery_codes.join('  ')}
                </pre>
                <h4>3. Onaylama kodunu gir</h4>
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
                      {busy() ? 'Doğrulanıyor…' : 'Aktive et'}
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
    if (!confirm(`${code} kodunu iptal et?`)) return;
    await api.del(`/invites/${code}`);
    refetch();
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  return (
    <>
      <p class="muted tiny">
        Günde maksimum 5 kod oluşturabilirsin. Her kod 14 gün geçerli ve tek kullanımlık.
      </p>
      <button class="primary" onClick={create} disabled={busy()}>
        {busy() ? 'Oluşturuluyor…' : 'Yeni davet kodu'}
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
                URL kopyala
              </button>
              <button class="ghost tiny" onClick={() => copy(l().code)} style="margin-left: 6px;">
                Kod kopyala
              </button>
            </div>
          </div>
        )}
      </Show>

      <h3 style="margin-top: 22px;">Davetlerin</h3>
      <Show when={data()} fallback={<p class="muted">Yükleniyor…</p>}>
        {(list) => (
          <For each={list()} fallback={<p class="muted">Henüz davet oluşturmamışsın.</p>}>
            {(inv) => (
              <div
                style="display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 13px;"
              >
                <code style="font-size: 13px;">{inv.code}</code>
                <span class="tiny muted">
                  {inv.redeemed_at
                    ? `✓ kullanıldı ${relDate(inv.redeemed_at)}`
                    : Date.parse(inv.expires_at) < Date.now()
                      ? '⊘ süresi doldu'
                      : `geçerli (son: ${new Date(inv.expires_at).toLocaleDateString('tr-TR')})`}
                </span>
                <Show when={!inv.redeemed_at && Date.parse(inv.expires_at) > Date.now()}>
                  <button class="ghost tiny" style="margin-left: auto;" onClick={() => revoke(inv.code)}>
                    iptal et
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
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
  });
}
