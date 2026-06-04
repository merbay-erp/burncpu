// Polled unread counts (notifications + DMs) that feed the tab-bar badges.
// React Native's XHR/SSE streaming is unreliable, so instead of the live event
// stream the web uses we just poll: two small GETs every 20s while the app is
// foregrounded, plus an immediate refresh on tab focus and after marking things
// read. Good enough to surface "you have new messages/notifications" without a
// native push round-trip.

import { useSyncExternalStore } from 'react';
import { api } from './api';
import { getMe } from './auth';

let notif = 0;
let dm = 0;
let snap = { notif: 0, dm: 0 };
const listeners = new Set<() => void>();

function publish() {
  if (snap.notif === notif && snap.dm === dm) return;
  snap = { notif, dm };
  listeners.forEach((l) => l());
}

/** Re-fetch both counts now. Cheap; safe to call on focus / after reads. */
export async function refreshUnread(): Promise<void> {
  if (!getMe()) {
    notif = 0;
    dm = 0;
    publish();
    return;
  }
  const [n, threads] = await Promise.all([
    api.get<{ unread: number }>('/notifications/count').catch(() => ({ unread: 0 })),
    api.get<{ unread_count: number }[]>('/dm/threads').catch(() => [] as { unread_count: number }[]),
  ]);
  notif = n?.unread ?? 0;
  dm = Array.isArray(threads) ? threads.reduce((s, t) => s + (t.unread_count || 0), 0) : 0;
  publish();
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the 20s poll loop (idempotent). Returns a stop function. */
export function startUnreadPolling(): () => void {
  void refreshUnread();
  if (!timer) timer = setInterval(() => void refreshUnread(), 20000);
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

export function useUnread(): { notif: number; dm: number } {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snap,
    () => snap,
  );
}
