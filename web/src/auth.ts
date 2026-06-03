// Auth store — single source of truth for "who am I" in the SPA.
//
// The session cookie is HttpOnly so JS can't read it. We probe identity
// by calling /users/me at startup; if it returns the current user we
// cache and use it, if it 401s we stay anon.

import { createSignal, createResource } from 'solid-js';
import { api, ApiError } from './api';

interface Me {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  role: string;
  pending_2fa: boolean;
  session_flagged?: boolean;
}

const STORAGE_KEY = 'burncpu.me';

function readCached(): Me | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

export const [me, setMe] = createSignal<Me | null>(readCached());

export function setCachedMe(m: Me | null) {
  setMe(m);
  if (m) localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  else localStorage.removeItem(STORAGE_KEY);
}

/// Calls /users/me. If the server returns the current user, cache it;
/// if it 401s, drop any local state. Returns true if logged in.
export async function probeSession(): Promise<boolean> {
  try {
    const m = await api.get<Me>('/users/me');
    setCachedMe(m);
    return true;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      setCachedMe(null);
    }
    return false;
  }
}

// `me` is the SOURCE so the badge re-fetches on login and clears on logout —
// reading me() inside the fetcher alone would not re-run it on auth changes.
export const [unread, { refetch: refetchUnread }] = createResource(
  me,
  async () => {
    try {
      const r = await api.get<{ unread: number }>('/notifications/count');
      return r.unread;
    } catch {
      return 0;
    }
  },
);

export async function logout() {
  try {
    await api.post('/auth/logout');
  } catch {
    // ignore — we still clear local state
  }
  setCachedMe(null);
  // Don't leave a half-written post draft behind for the next user on this device.
  try { localStorage.removeItem('burncpu.draft'); } catch { /* ignore */ }
  refetchUnread();
}
