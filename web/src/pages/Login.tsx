import { createSignal, Show } from 'solid-js';
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

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [invite, setInvite] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [sent, setSent] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);
  const [pkBusy, setPkBusy] = createSignal(false);

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
      const payload: { email: string; invite?: string } = { email: email().trim() };
      if (invite().trim()) payload.invite = invite().trim();
      await api.post('/auth/request', payload);
      setSent(true);
    } catch (e) {
      setErr((e as Error).message || t('login.error'));
    } finally {
      setBusy(false);
    }
  };

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

              <div>
                <label for="invite" class="block font-mono text-[11px] uppercase tracking-widest text-on-surface-variant mb-1.5">
                  {t('login.invite')} <span class="normal-case tracking-normal text-on-surface-variant/60">{t('login.invite_hint')}</span>
                </label>
                <input
                  id="invite"
                  type="text"
                  class={inputClass}
                  placeholder="xxxxxxxxxxxx"
                  value={invite()}
                  onInput={(e) => setInvite(e.currentTarget.value)}
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

            <Show when={passkeySupported()}>
              <div class="flex items-center gap-3 my-5">
                <div class="h-px flex-1 bg-outline-variant" />
                <span class="text-[11px] font-mono uppercase tracking-widest text-on-surface-variant/60">
                  {t('login.or')}
                </span>
                <div class="h-px flex-1 bg-outline-variant" />
              </div>
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
          </Show>
        </div>
      </div>
    </div>
  );
}
