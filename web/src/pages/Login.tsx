import { createSignal, Show } from 'solid-js';
import { api } from '../api';

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
      setErr((e as Error).message || 'gönderim hatası');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="auth-card">
      <h1>Giriş</h1>
      <p class="note">
        Şifre yok. Mailine kısa süreli (15 dk) bir bağlantı atılır.
      </p>
      <Show
        when={!sent()}
        fallback={
          <div class="success">
            <strong>Mail yolda.</strong> Inbox'ı kontrol et — link 15 dk geçerli.
            Sadece bu cihazda aç.
          </div>
        }
      >
        <form onSubmit={submit}>
          <label for="email">Email</label>
          <input
            id="email"
            type="email"
            autocomplete="email"
            required
            placeholder="sen@ornek.com"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            disabled={busy()}
          />
          <label for="invite">Davet kodu <span class="muted tiny">(yeni hesap için gerekli)</span></label>
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
              {busy() ? 'Gönderiliyor…' : 'Magic-link gönder'}
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
}
