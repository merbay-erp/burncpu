import { createSignal, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { api } from '../api';
import { refetchUnread, me } from '../auth';
import { t } from '../i18n';

export default function TwoFA() {
  const nav = useNavigate();
  const [code, setCode] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!code().trim() || busy()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post('/auth/2fa/challenge', { code: code().trim() });
      // Hard reload so session middleware re-evaluates pending_2fa.
      refetchUnread();
      nav('/', { replace: true });
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message || t('twofa.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="auth-card">
      <h1>{t('twofa.title')}</h1>
      <p class="note">
        <Show when={me()} fallback={<>{t('twofa.login_first')}</>}>
          {t('twofa.hint')}
        </Show>
      </p>
      <Show when={me()}>
        <form onSubmit={submit}>
          <label for="code">{t('twofa.code')}</label>
          <input
            id="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="123456"
            value={code()}
            onInput={(e) => setCode(e.currentTarget.value)}
            disabled={busy()}
            autofocus
          />
          <Show when={err()}>
            <div class="error">{err()}</div>
          </Show>
          <div style="margin-top: 18px; display: flex; justify-content: flex-end;">
            <button type="submit" class="primary" disabled={busy() || !code().trim()}>
              {busy() ? t('twofa.verifying') : t('twofa.submit')}
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
}
