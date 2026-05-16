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
    'nav.public': 'Public',
    'nav.feed': 'Feed',
    'nav.search': 'Ara',
    'nav.notifications': 'Bildirimler',
    'nav.profile': 'Profilim',
    'nav.bookmarks': 'Kayıtlılar',
    'nav.dm': 'Mesajlar',
    'nav.settings': 'Ayarlar',
    'nav.login': 'Giriş',
    'nav.logout': 'Çıkış',
    'compose.placeholder': 'Ne düşünüyorsun?',
    'compose.send': 'Gönder',
    'compose.reply': 'Yanıtla',
    'compose.sending': 'Gönderiliyor...',
    'compose.add_image': '📎 Görsel ekle',
    'compose.uploading': 'Yükleniyor…',
    'post.reactions': 'tepki',
    'post.replies': 'reply',
    'post.edited': 'edit',
    'post.deleted': '[silindi]',
    'home.title': 'Public timeline',
    'home.subtitle': 'herkesin paylaştığı',
    'home.empty': 'Henüz post yok. İlk paylaşan sen ol.',
    'feed.title': 'Feed',
    'feed.subtitle': 'takip ettiklerin + sen',
    'feed.empty': 'Sessiz. Public timeline\'a bak ya da birini takip et.',
    'feed.login_required': 'Feed\'i görmek için giriş yap.',
    'loading': 'Yükleniyor…',
    'load_more': 'daha yüklüyor…',
    'no_more': 'son.',
  },
  en: {
    'nav.public': 'Public',
    'nav.feed': 'Feed',
    'nav.search': 'Search',
    'nav.notifications': 'Notifications',
    'nav.profile': 'Me',
    'nav.bookmarks': 'Saved',
    'nav.dm': 'Messages',
    'nav.settings': 'Settings',
    'nav.login': 'Sign in',
    'nav.logout': 'Sign out',
    'compose.placeholder': 'What\'s on your mind?',
    'compose.send': 'Post',
    'compose.reply': 'Reply',
    'compose.sending': 'Posting...',
    'compose.add_image': '📎 Add image',
    'compose.uploading': 'Uploading…',
    'post.reactions': 'reactions',
    'post.replies': 'replies',
    'post.edited': 'edited',
    'post.deleted': '[deleted]',
    'home.title': 'Public timeline',
    'home.subtitle': 'everyone\'s posts',
    'home.empty': 'No posts yet. Be the first.',
    'feed.title': 'Feed',
    'feed.subtitle': 'people you follow + you',
    'feed.empty': 'Quiet. Check public timeline or follow someone.',
    'feed.login_required': 'Sign in to see your feed.',
    'loading': 'Loading…',
    'load_more': 'loading more…',
    'no_more': 'end.',
  },
};

export function t(key: string): string {
  return dict[locale()][key] ?? key;
}
