// Auth store — single source of truth for "who am I" in the SPA.
//
// The session cookie is HttpOnly so JS can't read it. We probe identity
// by calling a cheap authenticated endpoint (notifications/count) and
// caching the result. If the cookie's bad we get 401 and stay anon.

import { createSignal, createResource } from 'solid-js';
import { api, ApiError } from './api';

interface Me {
  username: string;
  display_name: string;
  role: string;
  pending_2fa: boolean;
}

// Probe by fetching unread count — endpoint is auth-only, so a 200 means
// we have a valid session. We separately fetch /users/me-like info by
// extracting the user from an extra call (no /me endpoint yet; fall back
// to caching the username we set during login).

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

/// Returns true if the server still recognizes our session.
export async function probeSession(): Promise<boolean> {
  try {
    await api.get<{ unread: number }>('/notifications/count');
    return true;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      setCachedMe(null);
    }
    return false;
  }
}

export const [unread, { refetch: refetchUnread }] = createResource(
  async () => {
    if (!me()) return 0;
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
  refetchUnread();
}
