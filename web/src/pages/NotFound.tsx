import { A } from '@solidjs/router';
import { t } from '../i18n';

export default function NotFound() {
  return (
    <div style="padding: 60px 0; text-align: center;">
      <h1 style="font-family: var(--mono); color: var(--accent); margin: 0;">404</h1>
      <p class="muted">{t('notfound.text')}</p>
      <p>
        <A href="/">{t('notfound.back')}</A>
      </p>
    </div>
  );
}
