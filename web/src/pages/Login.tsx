import { createSignal, createResource, For, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { api } from '../api';
import { probeSession } from '../auth';
import { loginWithPasskey, passkeySupported } from '../passkey';
import { t } from '../i18n';
import Logo from '../components/Logo';

const inputClass =
  'w-full px-4 py-2.5 rounded-lg bg-background border border-outline-variant text-on-surface ' +
  'placeholder:text-on-surface-variant/50 font-mono text-[14px] transition-colors disabled:opacity-50 ' +
  'focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

// Display labels for the OAuth providers the backend reports as configured.
const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  microsoft: 'Microsoft',
  apple: 'Apple',
};

// Brand logos rendered at the start of each social-login button.
function ProviderIcon(props: { provider: string }) {
  const p = props.provider;
  if (p === 'google')
    return (
      <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
    );
  if (p === 'github')
    return (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.63 8.21 11.19.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.37-1.34-1.74-1.34-1.74-1.09-.73.08-.72.08-.72 1.21.08 1.84 1.22 1.84 1.22 1.07 1.8 2.81 1.28 3.5.98.11-.76.42-1.28.76-1.57-2.67-.3-5.47-1.31-5.47-5.84 0-1.29.47-2.34 1.24-3.17-.12-.3-.54-1.52.12-3.16 0 0 1.01-.32 3.3 1.21.96-.26 1.98-.39 3-.4 1.02 0 2.04.14 3 .4 2.28-1.53 3.29-1.21 3.29-1.21.66 1.64.24 2.86.12 3.16.77.83 1.24 1.88 1.24 3.17 0 4.54-2.81 5.53-5.49 5.83.43.36.81 1.08.81 2.18 0 1.58-.01 2.85-.01 3.24 0 .31.22.68.83.56C20.56 21.91 24 17.5 24 12.29 24 5.78 18.63.5 12 .5z" />
      </svg>
    );
  if (p === 'microsoft')
    return (
      <svg width="15" height="15" viewBox="0 0 23 23" aria-hidden="true">
        <path fill="#F25022" d="M0 0h11v11H0z" />
        <path fill="#7FBA00" d="M12 0h11v11H12z" />
        <path fill="#00A4EF" d="M0 12h11v11H0z" />
        <path fill="#FFB900" d="M12 12h11v11H12z" />
      </svg>
    );
  return null;
}

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [sent, setSent] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const [pkBusy, setPkBusy] = createSignal(false);

  // Enabled social-login providers (empty until/unless the backend has creds).
  const [providers] = createResource(() =>
    api.get<string[]>('/oauth/providers').catch(() => [] as string[]),
  );

  const startOAuth = (provider: string) => {
    // Full-page navigation: backend 302s to the provider, then back to the
    // callback which sets the session cookie and returns us to the app.
    window.location.href = `/api/v1/oauth/${provider}/start`;
  };

  const passkey = async () => {
    if (pkBusy()) return;
    setPkBusy(true);
    setErr(null);
    try {
      await loginWithPasskey();
      await probeSession();
      navigate('/', { replace: true });
    } catch (e) {
      // A user cancelling the native prompt is not an error worth shouting about.
      const msg = (e as Error).message;
      if (msg && msg !== 'cancelled') setErr(t('login.passkey_error'));
    } finally {
      setPkBusy(false);
    }
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!email().trim() || busy()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post('/auth/request', { email: email().trim() });
      setSent(true);
    } catch (e) {
      setErr((e as Error).message || t('login.error'));
    } finally {
      setBusy(false);
    }
  };

  const hasAlternatives = () => (providers()?.length ?? 0) > 0 || passkeySupported();

  return (
    <div class="min-h-[70vh] flex items-center justify-center py-10">
      <div class="w-full max-w-[440px]">
        {/* Brand */}
        <div class="flex flex-col items-center text-center mb-7">
          <Logo size={44} class="logo-flame mb-3" />
          <div class="font-bold text-[26px] tracking-tight">
            <span class="burn-text">burn</span><span class="text-on-background">cpu</span>
          </div>
          <p class="text-[9px] text-on-surface-variant/70 font-mono tracking-[0.3em] uppercase mt-1.5">1 vps yeter</p>
        </div>

        {/* What is this — answers a first-time visitor's "what is BurnCPU?" */}
        <p class="text-center text-on-surface-variant text-[13.5px] leading-relaxed mb-5 max-w-[380px] mx-auto">
          Geliştiriciler, sistem yöneticileri ve üreticiler için sinyal ağı.
        </p>

        {/* Card */}
        <div class="bg-surface-container-high border border-outline-variant rounded-2xl p-6 sm:p-8 shadow-xl shadow-black/5">
          <h1 class="text-[22px] font-bold text-on-background mb-1.5">{t('nav.login')}</h1>
          <p class="text-on-surface-variant text-[13.5px] leading-relaxed mb-6">{t('login.note')}</p>

          <Show
            when={!sent()}
            fallback={
              <div class="flex items-start gap-3 p-4 rounded-xl bg-primary/10 border border-primary/30">
                <div class="text-[22px] leading-none">🔥</div>
                <div>
                  <strong class="block text-on-background text-[14px] mb-0.5">{t('login.sent_title')}</strong>
                  <span class="text-on-surface-variant text-[13px] leading-relaxed">{t('login.sent_body')}</span>
                </div>
              </div>
            }
          >
            <form onSubmit={submit} class="space-y-4">
              <div>
                <label for="email" class="block font-mono text-[11px] uppercase tracking-widest text-on-surface-variant mb-1.5">
                  {t('login.email')}
                </label>
                <input
                  id="email"
                  type="email"
                  autocomplete="email"
                  required
                  class={inputClass}
                  placeholder={t('login.email_placeholder')}
                  value={email()}
                  onInput={(e) => setEmail(e.currentTarget.value)}
                  disabled={busy()}
                />
              </div>

              <Show when={err()}>
                <div class="p-3 rounded-lg bg-error/10 border border-error/30 text-error text-[13px] font-mono">{err()}</div>
              </Show>

              <button
                type="submit"
                disabled={busy() || !email().trim()}
                class="w-full py-2.5 rounded-lg bg-primary text-on-primary font-bold font-mono text-[14px] hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {busy() ? t('login.sending') : t('login.submit')}
              </button>
            </form>

            <Show when={hasAlternatives()}>
              <div class="flex items-center gap-3 my-5">
                <div class="h-px flex-1 bg-outline-variant" />
                <span class="text-[11px] font-mono uppercase tracking-widest text-on-surface-variant/60">
                  {t('login.or')}
                </span>
                <div class="h-px flex-1 bg-outline-variant" />
              </div>

              <div class="space-y-2.5">
                <For each={providers() ?? []}>
                  {(provider) => (
                    <button
                      type="button"
                      onClick={() => startOAuth(provider)}
                      class="w-full py-2.5 rounded-lg border border-outline-variant text-on-background font-bold font-mono text-[14px] hover:bg-surface-container active:scale-[0.98] transition-all flex items-center justify-center gap-2.5"
                    >
                      <ProviderIcon provider={provider} />
                      <span>{(PROVIDER_LABELS[provider] ?? provider)} ile devam et</span>
                    </button>
                  )}
                </For>

                <Show when={passkeySupported()}>
                  <button
                    type="button"
                    onClick={passkey}
                    disabled={pkBusy() || busy()}
                    class="w-full py-2.5 rounded-lg border border-outline-variant text-on-background font-bold font-mono text-[14px] hover:bg-surface-container active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    <span class="text-[16px] leading-none">🔑</span>
                    {pkBusy() ? t('login.passkey_busy') : t('login.passkey')}
                  </button>
                </Show>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}
