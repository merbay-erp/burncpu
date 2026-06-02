// Polished "sign in to continue" state for auth-gated pages, shown to
// logged-out visitors instead of a bare one-line message.

import { A } from '@solidjs/router';
import { t } from '../i18n';

export default function AuthGate(props: { icon?: string; title?: string }) {
  return (
    <div class="flex flex-col items-center justify-center text-center py-16 px-6">
      <div class="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
        <span class="material-symbols-outlined text-primary" style="font-size: 30px;">{props.icon ?? 'lock'}</span>
      </div>
      <h2 class="text-[18px] font-bold text-on-background mb-1.5">{props.title ?? t('auth.gate_title')}</h2>
      <p class="text-on-surface-variant text-[13px] font-mono mb-5 max-w-[300px] leading-relaxed">{t('auth.gate_sub')}</p>
      <A
        href="/login"
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-on-primary font-bold font-mono text-[13px] hover:opacity-90 active:scale-95 transition-all"
      >
        <span class="material-symbols-outlined" style="font-size: 18px;">login</span>
        {t('auth.login_link')}
      </A>
    </div>
  );
}
