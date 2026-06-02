// Session/auth store. The session itself lives in the native cookie jar (set by
// magic-link verify or passkey login); here we cache the resolved user so the UI
// can react instantly, exactly like the web's `me()` signal.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { api, ApiError } from './api';

export interface Me {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  role: string;
  pending_2fa: boolean;
  session_flagged?: boolean;
}

const KEY = 'burncpu.me';
let current: Me | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getMe = (): Me | null => current;

export function useMe(): Me | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
}

export async function setMe(m: Me | null): Promise<void> {
  current = m;
  emit();
  try {
    if (m) await AsyncStorage.setItem(KEY, JSON.stringify(m));
    else await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Load the cached user (instant), called once on launch before probing. */
export async function hydrate(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      current = JSON.parse(raw) as Me;
      emit();
    }
  } catch {
    /* ignore */
  }
}

/** Confirm the session against the server; drops local state on 401/403. */
export async function probeSession(): Promise<boolean> {
  try {
    const m = await api.get<Me>('/users/me');
    await setMe(m);
    return true;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) await setMe(null);
    return false;
  }
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } catch {
    /* ignore */
  }
  await setMe(null);
}
