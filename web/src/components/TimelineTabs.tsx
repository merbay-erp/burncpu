import { A, useLocation } from '@solidjs/router';
import { t } from '../i18n';

// Segmented control at the top of the timeline: "Bana Özel" (your following
// feed, /feed) and "Global" (the public timeline, /). Replaces the two separate
// sidebar entries with one "Akış" entry + these tabs.
export default function TimelineTabs() {
  const loc = useLocation();
  const tab = (href: string, label: string) => (
    <A
      href={href}
      class={`flex-1 text-center px-4 py-2 rounded-lg font-mono text-[13px] font-bold transition-colors ${
        loc.pathname === href
          ? 'bg-primary text-on-primary'
          : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
      }`}
    >
      {label}
    </A>
  );
  return (
    <div class="flex gap-1 p-1 bg-surface-container-low border border-outline-variant rounded-xl mb-6 max-w-[360px]">
      {tab('/feed', t('nav.tab_personal'))}
      {tab('/', t('nav.tab_global'))}
    </div>
  );
}
