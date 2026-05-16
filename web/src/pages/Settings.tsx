import { createSignal, Show, For, createResource, onMount } from 'solid-js';
import QRCode from 'qrcode';
import { api, type Profile } from '../api';
import { me, setCachedMe } from '../auth';

type Tab = 'profile' | 'security' | 'invites';

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
      </Show>
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
  const [msg, setMsg] = createSignal<{ kind: 'ok' | 'err'; text: string } | null>(null);

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
      <label class="muted tiny" style="margin-top: 12px; display:block;">
        Avatar URL <span class="muted tiny">(https://… olmalı, boşsa kaldırma yok)</span>
      </label>
      <input
        type="url"
        placeholder="https://..."
        value={avatarUrl()}
        onInput={(e) => setAvatarUrl(e.currentTarget.value)}
      />
      <Show when={msg()}>
        {(m) => <div class={m().kind === 'ok' ? 'success' : 'error'}>{m().text}</div>}
      </Show>
      <div style="margin-top: 18px;">
        <button type="submit" class="primary" disabled={busy()}>
          {busy() ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </div>
    </form>
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
