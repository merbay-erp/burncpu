import { A } from '@solidjs/router';

export default function NotFound() {
  return (
    <div style="padding: 60px 0; text-align: center;">
      <h1 style="font-family: var(--mono); color: var(--accent); margin: 0;">404</h1>
      <p class="muted">Bu adres yok.</p>
      <p>
        <A href="/">Ana sayfaya dön</A>
      </p>
    </div>
  );
}
