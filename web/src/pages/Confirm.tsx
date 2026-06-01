import { createSignal, onMount, Show } from 'solid-js';
import { useNavigate, useParams, A } from '@solidjs/router';
import { api, ApiError } from '../api';
import { probeSession } from '../auth';
import { t } from '../i18n';

interface VerifyResponse {
  ok: boolean;
  pending_2fa: boolean;
}

export default function Confirm() {
  const params = useParams<{ token: string }>();
  const nav = useNavigate();
  const [busy, setBusy] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  onMount(async () => {
    const live = await probeSession();
    if (live) {
      setDone(true);
      setTimeout(() => nav('/', { replace: true }), 400);
    }
  });

  const confirm = async () => {
    if (busy()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<VerifyResponse>(`/auth/verify/${params.token}`);
      await probeSession();
      setDone(true);
      setTimeout(() => nav(r.pending_2fa ? '/2fa' : '/', { replace: true }), 500);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setErr(t('confirm.error_expired'));
      } else {
        setErr(t('confirm.error_generic'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="auth-card">
      <h1>{t('confirm.title')}</h1>
      <Show
        when={!done()}
        fallback={<div class="success">{t('confirm.done')}</div>}
      >
        <p class="note">
          {t('confirm.note')}
        </p>
        <Show when={err()}>
          <div class="error">{err()}</div>
        </Show>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px;">
          <A href="/login" class="button">{t('confirm.request_new')}</A>
          <button class="primary" onClick={confirm} disabled={busy()}>
            {busy() ? t('confirm.verifying') : t('confirm.submit')}
          </button>
        </div>
      </Show>
    </div>
  );
}
