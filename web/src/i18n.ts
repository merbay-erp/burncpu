// Tiny i18n — flat string table, lookup by key, locale persisted in
// localStorage. Pluralization is single-form; for now we don't need
// ICU complexity. Defaults to Turkish.

import { createSignal } from 'solid-js';

type Locale = 'tr' | 'en';

const KEY = 'burncpu.locale';

const initial: Locale = (() => {
  const stored = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) as Locale | null;
  if (stored === 'tr' || stored === 'en') return stored;
  const nav = (typeof navigator !== 'undefined' && navigator.language?.toLowerCase()) || 'tr';
  return nav.startsWith('en') ? 'en' : 'tr';
})();

export const [locale, _setLocale] = createSignal<Locale>(initial);

export function setLocale(l: Locale) {
  _setLocale(l);
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
}

const dict: Record<Locale, Record<string, string>> = {
  tr: {
    // ── nav / shell ──
    'nav.timeline': 'Akış',
    'nav.feed': 'Feed',
    'nav.search': 'Ara',
    'nav.notifications': 'Bildirimler',
    'nav.dm': 'Mesajlar',
    'nav.profile': 'Profil',
    'nav.bookmarks': 'Kayıtlılar',
    'nav.trash': 'Çöp',
    'nav.settings': 'Ayarlar',
    'nav.admin': 'Admin',
    'nav.login': 'Giriş',
    'nav.logout': 'Çıkış',
    'nav.post_signal': 'Sinyal Gönder',
    'nav.new_post': 'Yeni post',
    'nav.search_placeholder': 'Sinyali ara…',
    // ── common ──
    'common.cancel': 'İptal',
    'common.loading': 'Yükleniyor…',
    'loading': 'Yükleniyor…',
    // ── compose ──
    'compose.placeholder': 'Yeni bir sinyal gönder…',
    'compose.send': 'Gönder',
    'compose.reply': 'Yanıtla',
    'compose.sending': 'Gönderiliyor…',
    // ── home / feed ──
    'home.title': 'Public Timeline',
    'home.subtitle': 'yüksek performans gridinden gerçek zamanlı işlem.',
    'home.empty': 'Sinyal sessiz. İlk yayın senden.',
    'feed.title': 'Feed',
    'feed.subtitle': 'takip ettiklerin + sen',
    'feed.empty': 'Sessiz. Public timeline\'a bak ya da birini takip et.',
    'feed.login_required': 'Feed\'i görmek için giriş yap.',
    // ── dm ──
    'dm.title': 'Mesajlar',
    'dm.new': 'Yeni mesaj',
    'dm.search_user': 'Kullanıcı ara…',
    'dm.no_user': 'Kullanıcı bulunamadı.',
    'dm.mutual_required': 'DM atabilmek için iki tarafın da birbirini takip etmesi gerekiyor.',
    'dm.empty': 'Henüz mesajın yok. Yukarıdan yeni bir konuşma başlat.',
    'dm.new_count': 'yeni',
  },
  en: {
    'nav.timeline': 'Timeline',
    'nav.feed': 'Feed',
    'nav.search': 'Search',
    'nav.notifications': 'Notifications',
    'nav.dm': 'Messages',
    'nav.profile': 'Profile',
    'nav.bookmarks': 'Saved',
    'nav.trash': 'Trash',
    'nav.settings': 'Settings',
    'nav.admin': 'Admin',
    'nav.login': 'Sign in',
    'nav.logout': 'Sign out',
    'nav.post_signal': 'Post Signal',
    'nav.new_post': 'New post',
    'nav.search_placeholder': 'Search the signal…',
    'common.cancel': 'Cancel',
    'common.loading': 'Loading…',
    'loading': 'Loading…',
    'compose.placeholder': 'Transmit a new signal…',
    'compose.send': 'Transmit',
    'compose.reply': 'Reply',
    'compose.sending': 'Transmitting…',
    'home.title': 'Public Timeline',
    'home.subtitle': 'real-time processing from the high-performance grid.',
    'home.empty': 'Signal silent. First transmission is yours.',
    'feed.title': 'Feed',
    'feed.subtitle': 'people you follow + you',
    'feed.empty': 'Quiet. Check the public timeline or follow someone.',
    'feed.login_required': 'Sign in to see your feed.',
    'dm.title': 'Messages',
    'dm.new': 'New message',
    'dm.search_user': 'Search a user…',
    'dm.no_user': 'No user found.',
    'dm.mutual_required': 'Both people must follow each other to exchange DMs.',
    'dm.empty': 'No messages yet. Start a new conversation above.',
    'dm.new_count': 'new',
  },
};

export function t(key: string): string {
  return dict[locale()][key] ?? key;
}
