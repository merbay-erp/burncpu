import { A } from '@solidjs/router';
import { t } from '../i18n';

// Shown at the top of the public timeline to logged-out visitors. The timeline
// stays visible underneath as live social proof — this just answers "what is
// this / why join" and gives a single obvious way in. Logged-in users never see
// it.
export default function LandingHero() {
  return (
    <section class="mb-6 rounded-2xl border border-outline-variant bg-surface-container-lowest overflow-hidden">
      <div class="p-6 md:p-8">
        <div class="w-12 h-1.5 rounded-full bg-primary mb-5" />
        <h1 class="text-[26px] md:text-[32px] font-bold tracking-tight text-on-surface leading-tight">
          {t('landing.headline')}
        </h1>
        <p class="mt-2.5 text-on-surface-variant text-body-lg max-w-xl">{t('landing.tagline')}</p>
        <div class="mt-6 flex flex-wrap items-center gap-3">
          <A
            href="/login"
            class="inline-flex items-center gap-2 pl-4 pr-5 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-[15px] hover:opacity-95 active:scale-95 transition"
          >
            <span class="material-symbols-outlined text-[20px]">bolt</span>
            {t('landing.cta_join')}
          </A>
          <A
            href="/login"
            class="inline-flex items-center px-4 py-2.5 rounded-xl border border-outline-variant text-on-surface font-semibold text-[15px] hover:bg-surface-container transition"
          >
            {t('landing.cta_login')}
          </A>
        </div>
        <p class="mt-4 text-on-surface-variant/70 font-mono text-[12.5px]">{t('landing.sub')}</p>
      </div>
    </section>
  );
}
