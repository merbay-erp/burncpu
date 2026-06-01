import { createSignal, Show } from 'solid-js';
import { api } from '../api';
import { t } from '../i18n';

export default function Login() {
  const [email, setEmail] = createSignal('');
  const [invite, setInvite] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [sent, setSent] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

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
    <div class="auth-card">
      <h1>{t('nav.login')}</h1>
      <p class="note">
        {t('login.note')}
      </p>
      <Show
        when={!sent()}
        fallback={
          <div class="success">
            <strong>{t('login.sent_title')}</strong> {t('login.sent_body')}
          </div>
        }
      >
        <form onSubmit={submit}>
          <label for="email">{t('login.email')}</label>
          <input
            id="email"
            type="email"
            autocomplete="email"
            required
            placeholder={t('login.email_placeholder')}
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            disabled={busy()}
          />
          <label for="invite">{t('login.invite')} <span class="muted tiny">{t('login.invite_hint')}</span></label>
          <input
            id="invite"
            type="text"
            placeholder="xxxxxxxxxxxx"
            value={invite()}
            onInput={(e) => setInvite(e.currentTarget.value)}
            disabled={busy()}
          />
          <Show when={err()}>
            <div class="error">{err()}</div>
          </Show>
          <div style="margin-top: 18px; display: flex; justify-content: flex-end;">
            <button type="submit" class="primary" disabled={busy() || !email().trim()}>
              {busy() ? t('login.sending') : t('login.submit')}
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
}
