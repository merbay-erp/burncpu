// Native passkeys (WebAuthn) via react-native-passkeys — iOS ASAuthorization /
// Android Credential Manager. The library speaks the same base64url JSON the
// server (webauthn-rs) emits/expects, so we pass the options through and send
// the result back, mirroring web/src/passkey.ts. Requires a dev build + the
// webcredentials Associated Domain (see app.json) and the server AASA.

import { create, get, isSupported } from 'react-native-passkeys';
import { api } from './api';

type AnyOptions = Record<string, unknown>;

export const passkeySupported = (): boolean => {
  try {
    return isSupported();
  } catch {
    return false;
  }
};

// webauthn-rs includes `extensions` (cred-protect) + sometimes `hints`, which
// react-native-passkeys' typed request doesn't accept — drop them.
function clean(publicKey: AnyOptions): AnyOptions {
  const o: AnyOptions = { ...publicKey };
  delete o.extensions;
  delete o.hints;
  return o;
}

export async function registerPasskey(name?: string): Promise<void> {
  const { publicKey } = await api.post<{ publicKey: AnyOptions }>('/auth/passkeys/register/start');
  const credential = await create(clean(publicKey) as Parameters<typeof create>[0]);
  if (!credential) throw new Error('cancelled');
  await api.post('/auth/passkeys/register/finish', { name: name?.trim() || undefined, credential });
}

export async function loginWithPasskey(): Promise<{ ok: boolean; pending_2fa: boolean }> {
  const start = await api.post<{ ceremony: string; options: { publicKey: AnyOptions } }>(
    '/auth/passkeys/login/start',
  );
  const credential = await get(clean(start.options.publicKey) as Parameters<typeof get>[0]);
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
