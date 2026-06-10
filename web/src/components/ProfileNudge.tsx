import { createSignal, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { me } from '../auth';
import { t } from '../i18n';

const KEY = 'burncpu.profileNudgeDismissed';

// Gentle one-time prompt for signed-in users who haven't set an avatar — the
// most visible gap (everyone shows a 🐢 placeholder, and avatar-less accounts
// get followed less from the "who to follow" suggestions). Dismissible and
// remembered, so it nudges once and never nags. Reads avatar straight off the
// cached session — no extra fetch.
export default function ProfileNudge() {
  const [dismissed, setDismissed] = createSignal(
    typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1',
  );

  const show = () => {
    const u = me();
    return !!u && !u.avatar_url && !dismissed();
  };

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <Show when={show()}>
      <div class="mb-6 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <span class="material-symbols-outlined text-primary text-[24px] shrink-0">account_circle</span>
        <div class="min-w-0 flex-1">
          <div class="font-semibold text-on-surface text-body-md">{t('nudge.profile_title')}</div>
          <div class="text-on-surface-variant text-body-sm">{t('nudge.profile_body')}</div>
        </div>
        <A
          href="/settings"
          class="shrink-0 px-3.5 py-1.5 rounded-xl bg-primary text-on-primary font-bold text-[13px] hover:opacity-95 active:scale-95 transition"
        >
          {t('nudge.profile_cta')}
        </A>
        <button
          type="button"
          onClick={dismiss}
          class="shrink-0 p-1 text-on-surface-variant hover:text-on-surface transition-colors"
          aria-label={t('nudge.dismiss')}
        >
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>
    </Show>
  );
}
