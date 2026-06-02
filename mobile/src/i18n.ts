// i18n — flat t(key) dict mirroring the web. Turkish-first (the web defaults to
// tr). Curated to the keys the mobile screens use; extend as screens land.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export type Locale = 'tr' | 'en';

const dict: Record<Locale, Record<string, string>> = {
  tr: {
    'common.loading': 'Yükleniyor…',
    'common.cancel': 'Vazgeç',
    'common.retry': 'Tekrar dene',
    'common.error': 'Bir şeyler ters gitti',
    'nav.home': 'Akış',
    'nav.search': 'Ara',
    'nav.notifications': 'Bildirimler',
    'nav.dms': 'Mesajlar',
    'nav.profile': 'Profil',
    'nav.login': 'Giriş yap',
    'nav.logout': 'Çıkış yap',
    'nav.settings': 'Ayarlar',
    'home.foryou': 'Bana Özel',
    'home.global': 'Global',
    'home.empty': 'Henüz sinyal yok.',
    'home.end': 'YAYIN SONU',
    'login.note': 'E-postanı gir, sana bir sihirli bağlantı gönderelim. Parola yok.',
    'login.email': 'E-posta',
    'login.email_placeholder': 'sen@ornek.com',
    'login.invite': 'Davet kodu',
    'login.invite_hint': '(gerekliyse)',
    'login.submit': 'Magic-link gönder',
    'login.sending': 'Gönderiliyor…',
    'login.sent_title': 'Bağlantı yolda',
    'login.sent_body': 'E-postandaki bağlantıya bu cihazda dokun; oturum açılır.',
    'login.error': 'Gönderim hatası',
    'login.or': 'veya',
    'login.passkey': 'Passkey ile gir',
    'login.passkey_busy': 'Bekleniyor…',
    'login.passkey_error': 'Passkey ile giriş başarısız',
    'login.gate_title': 'Bu bölüm için giriş gerekli',
    'login.gate_body': 'Akışını, bildirimlerini ve mesajlarını görmek için giriş yap.',
    'post.reply': 'Yanıtla',
    'post.edit_marker': 'düzenlendi',
    'post.history_title': 'Düzenleme geçmişi',
    'post.history_empty': 'Önceki sürüm kaydı yok.',
    'post.history_error': 'Geçmiş yüklenemedi',
    'post.content_warning': 'İçerik uyarısı',
    'post.cw_show': 'Göster',
    'post.deleted': 'silinmiş',
    'compose.placeholder': 'Neler oluyor?',
    'compose.post': 'Gönder',
    'compose.posting': 'Gönderiliyor…',
    'compose.pending': 'Gönderin incelemeye alındı.',
    'profile.follow': 'Takip et',
    'profile.following': 'Takip ediliyor',
    'profile.unfollow': 'Bırak',
    'profile.posts': 'gönderi',
    'profile.followers': 'takipçi',
    'profile.followingc': 'takip',
    'profile.edit': 'Profili düzenle',
    'search.placeholder': 'Sinyal ara…',
    'search.empty': 'Aramak için yaz.',
    'notifications.empty': 'Henüz bildirim yok.',
    'notif.reaction': 'tepki verdi',
    'notif.reply': 'yanıtladı',
    'notif.follow': 'seni takip etti',
    'notif.mention': 'senden bahsetti',
  },
  en: {
    'common.loading': 'Loading…',
    'common.cancel': 'Cancel',
    'common.retry': 'Retry',
    'common.error': 'Something went wrong',
    'nav.home': 'Feed',
    'nav.search': 'Search',
    'nav.notifications': 'Notifications',
    'nav.dms': 'Messages',
    'nav.profile': 'Profile',
    'nav.login': 'Sign in',
    'nav.logout': 'Sign out',
    'nav.settings': 'Settings',
    'home.foryou': 'For you',
    'home.global': 'Global',
    'home.empty': 'No signal yet.',
    'home.end': 'END OF TRANSMISSION',
    'login.note': 'Enter your email and we’ll send a magic link. No password.',
    'login.email': 'Email',
    'login.email_placeholder': 'you@example.com',
    'login.invite': 'Invite code',
    'login.invite_hint': '(if required)',
    'login.submit': 'Send magic link',
    'login.sending': 'Sending…',
    'login.sent_title': 'Link on the way',
    'login.sent_body': 'Tap the link in your email on this device to sign in.',
    'login.error': 'Send failed',
    'login.or': 'or',
    'login.passkey': 'Sign in with a passkey',
    'login.passkey_busy': 'Waiting…',
    'login.passkey_error': 'Passkey sign-in failed',
    'login.gate_title': 'Sign in to continue',
    'login.gate_body': 'Sign in to see your feed, notifications and messages.',
    'post.reply': 'Reply',
    'post.edit_marker': 'edited',
    'post.history_title': 'Edit history',
    'post.history_empty': 'No prior versions recorded.',
    'post.history_error': 'Could not load history',
    'post.content_warning': 'Content warning',
    'post.cw_show': 'Show',
    'post.deleted': 'deleted',
    'compose.placeholder': 'What’s happening?',
    'compose.post': 'Post',
    'compose.posting': 'Posting…',
    'compose.pending': 'Your post was sent for review.',
    'profile.follow': 'Follow',
    'profile.following': 'Following',
    'profile.unfollow': 'Unfollow',
    'profile.posts': 'posts',
    'profile.followers': 'followers',
    'profile.followingc': 'following',
    'profile.edit': 'Edit profile',
    'search.placeholder': 'Search signals…',
    'search.empty': 'Type to search.',
    'notifications.empty': 'No notifications yet.',
    'notif.reaction': 'reacted',
    'notif.reply': 'replied',
    'notif.follow': 'followed you',
    'notif.mention': 'mentioned you',
  },
};

const KEY = 'burncpu.locale';
let locale: Locale = 'tr';
const listeners = new Set<() => void>();

export function useLocale(): Locale {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => locale,
    () => locale,
  );
}

export function setLocale(l: Locale): void {
  locale = l;
  listeners.forEach((fn) => fn());
  AsyncStorage.setItem(KEY, l).catch(() => {});
}

export async function hydrateLocale(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v === 'tr' || v === 'en') {
      locale = v;
      listeners.forEach((fn) => fn());
    }
  } catch {
    /* ignore */
  }
}

export function t(key: string): string {
  return dict[locale][key] ?? dict.en[key] ?? key;
}
