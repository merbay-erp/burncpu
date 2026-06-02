// WebAuthn (passkey) browser glue.
//
// Talks to /auth/passkeys/* and converts by hand between the server's
// base64url JSON (the wire shape webauthn-rs emits/expects) and the browser's
// ArrayBuffer-based credential API — no extra dependency, no lockfile churn.
// Field names mirror the WebAuthn spec exactly so the server deserializes them
// straight into RegisterPublicKeyCredential / PublicKeyCredential.

import { api } from './api';

interface CredDescriptor {
  id: string;
  type: string;
  transports?: string[];
}
interface ServerPublicKey {
  publicKey: Record<string, unknown> & {
    challenge: string;
    user?: { id: string; name: string; displayName: string };
    excludeCredentials?: CredDescriptor[];
    allowCredentials?: CredDescriptor[];
  };
}

const b64urlToBuf = (s: string): ArrayBuffer => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
};

const bufToB64url = (buf: ArrayBuffer): string => {
  const u8 = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Whether this browser exposes the WebAuthn credential API. */
export const passkeySupported = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.PublicKeyCredential === 'function' &&
  typeof navigator.credentials?.create === 'function';

/** Register a new passkey for the signed-in user. */
export async function registerPasskey(name?: string): Promise<void> {
  const { publicKey: pk } = await api.post<ServerPublicKey>('/auth/passkeys/register/start');
  const publicKey = {
    ...pk,
    challenge: b64urlToBuf(pk.challenge),
    user: { ...pk.user!, id: b64urlToBuf(pk.user!.id) },
    excludeCredentials: (pk.excludeCredentials ?? []).map((c) => ({
      ...c,
      id: b64urlToBuf(c.id),
    })),
  } as unknown as PublicKeyCredentialCreationOptions;

  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelled');
  const r = cred.response as AuthenticatorAttestationResponse;

  await api.post('/auth/passkeys/register/finish', {
    name: name?.trim() || undefined,
    credential: {
      id: cred.id,
      rawId: bufToB64url(cred.rawId),
      type: cred.type,
      response: {
        attestationObject: bufToB64url(r.attestationObject),
        clientDataJSON: bufToB64url(r.clientDataJSON),
      },
    },
  });
}

/** Sign in with a discoverable (usernameless) passkey. Sets the session cookie. */
export async function loginWithPasskey(): Promise<{ ok: boolean; pending_2fa: boolean }> {
  const start = await api.post<{ ceremony: string; options: ServerPublicKey }>(
    '/auth/passkeys/login/start',
  );
  const pk = start.options.publicKey;
  const publicKey = {
    ...pk,
    challenge: b64urlToBuf(pk.challenge),
    allowCredentials: (pk.allowCredentials ?? []).map((c) => ({
      ...c,
      id: b64urlToBuf(c.id),
    })),
  } as unknown as PublicKeyCredentialRequestOptions;

  const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelled');
  const r = cred.response as AuthenticatorAssertionResponse;

  return api.post('/auth/passkeys/login/finish', {
    ceremony: start.ceremony,
    credential: {
      id: cred.id,
      rawId: bufToB64url(cred.rawId),
      type: cred.type,
      response: {
        authenticatorData: bufToB64url(r.authenticatorData),
        clientDataJSON: bufToB64url(r.clientDataJSON),
        signature: bufToB64url(r.signature),
        userHandle: r.userHandle ? bufToB64url(r.userHandle) : null,
      },
    },
  });
}

export interface PasskeyInfo {
  id: string;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export const listPasskeys = () => api.get<PasskeyInfo[]>('/auth/passkeys');
export const deletePasskey = (id: string) => api.del(`/auth/passkeys/${id}`);
