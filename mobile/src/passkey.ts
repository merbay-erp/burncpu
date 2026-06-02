// Native passkeys (WebAuthn) via react-native-passkeys — iOS ASAuthorization /
// Android Credential Manager. Talks to the same /auth/passkeys/* backend as the
// web; react-native-passkeys speaks the same base64url JSON the server emits.
//
// react-native-passkeys is a NATIVE module: it doesn't exist in Expo Go and
// throws if imported there. So we load it lazily + guarded — the app still runs
// in Expo Go (passkeys simply hidden) and works in a native dev build.

import { api } from './api';

type RNPasskeys = typeof import('react-native-passkeys');
type AnyOptions = Record<string, unknown>;

let cached: RNPasskeys | null | undefined;
function passkeys(): RNPasskeys | null {
  if (cached === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cached = require('react-native-passkeys') as RNPasskeys;
    } catch {
      cached = null;
    }
  }
  return cached;
}

export const passkeySupported = (): boolean => {
  try {
    const m = passkeys();
    return !!m && m.isSupported();
  } catch {
    return false;
  }
};

// webauthn-rs adds `extensions` (cred-protect) + sometimes `hints`, which
// react-native-passkeys' typed request doesn't accept — drop them.
function clean(publicKey: AnyOptions): AnyOptions {
  const o: AnyOptions = { ...publicKey };
  delete o.extensions;
  delete o.hints;
  return o;
}

export async function registerPasskey(name?: string): Promise<void> {
  const m = passkeys();
  if (!m) throw new Error('passkeys unavailable');
  const { publicKey } = await api.post<{ publicKey: AnyOptions }>('/auth/passkeys/register/start');
  const credential = await m.create(clean(publicKey) as Parameters<typeof m.create>[0]);
  if (!credential) throw new Error('cancelled');
  await api.post('/auth/passkeys/register/finish', { name: name?.trim() || undefined, credential });
}

export async function loginWithPasskey(): Promise<{ ok: boolean; pending_2fa: boolean }> {
  const m = passkeys();
  if (!m) throw new Error('passkeys unavailable');
  const start = await api.post<{ ceremony: string; options: { publicKey: AnyOptions } }>(
    '/auth/passkeys/login/start',
  );
  const credential = await m.get(clean(start.options.publicKey) as Parameters<typeof m.get>[0]);
  if (!credential) throw new Error('cancelled');
  return api.post('/auth/passkeys/login/finish', { ceremony: start.ceremony, credential });
}

export interface PasskeyInfo {
  id: string;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export const listPasskeys = () => api.get<PasskeyInfo[]>('/auth/passkeys');
export const deletePasskey = (id: string) => api.del(`/auth/passkeys/${id}`);
