/**
 * zkLogin session management — client-only.
 * Import only from client components or callback pages (uses sessionStorage + window).
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { generateNonce, generateRandomness, genAddressSeed } from '@mysten/sui/zklogin';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';

const KEYS = {
  EPHEMERAL_KEY: 'cashpan_ephemeral_key',
  RANDOMNESS:    'cashpan_randomness',
  MAX_EPOCH:     'cashpan_max_epoch',
  JWT:           'cashpan_jwt',
  SALT:          'cashpan_salt',
  ADDRESS:       'cashpan_address',
  ZK_PROOF:      'cashpan_zk_proof',
  USER:          'cashpan_user',
} as const;

export interface ZkLoginSession {
  address: string;
  sub: string;
  aud: string;
  email?: string;
  name?: string;
  picture?: string;
}

function getClient(): SuiJsonRpcClient {
  const network = process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet';
  return new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network as 'testnet'), network });
}

export async function startLogin(): Promise<void> {
  const client = getClient();
  const { epoch } = await client.getLatestSuiSystemState();
  const maxEpoch = Number(epoch) + 10;

  const ephemeralKey = new Ed25519Keypair();
  const randomness = generateRandomness();
  const nonce = generateNonce(ephemeralKey.getPublicKey(), maxEpoch, randomness);

  sessionStorage.setItem(KEYS.EPHEMERAL_KEY, ephemeralKey.getSecretKey());
  sessionStorage.setItem(KEYS.RANDOMNESS, randomness.toString());
  sessionStorage.setItem(KEYS.MAX_EPOCH, String(maxEpoch));

  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.NEXT_PUBLIC_REDIRECT_URL!,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce,
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function handleCallback(): Promise<ZkLoginSession> {
  const jwt = new URLSearchParams(window.location.hash.slice(1)).get('id_token');
  if (!jwt) throw new Error('No id_token in callback URL');

  const ephemeralKeyStr = sessionStorage.getItem(KEYS.EPHEMERAL_KEY);
  const randomness      = sessionStorage.getItem(KEYS.RANDOMNESS);
  const maxEpoch        = Number(sessionStorage.getItem(KEYS.MAX_EPOCH));
  if (!ephemeralKeyStr || !randomness || !maxEpoch) {
    throw new Error('Login state missing — start login again');
  }

  const ephemeralKey = Ed25519Keypair.fromSecretKey(ephemeralKeyStr);

  // Decode JWT claims (manual — no library needed)
  const claims = JSON.parse(atob(jwt.split('.')[1])) as {
    sub: string;
    aud: string | string[];
    email?: string;
    name?: string;
    picture?: string;
  };
  const sub = claims.sub;
  const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;

  // Shinami zkWallet: returns stable salt + derived address (idempotent per sub)
  const saltRes = await fetch('/api/salt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jwt }),
  });
  if (!saltRes.ok) {
    const err = await saltRes.json().catch(() => ({ error: saltRes.statusText })) as { error?: string };
    throw new Error(err.error ?? 'Salt fetch failed');
  }
  const { salt, address } = await saltRes.json() as { salt: string; address: string };

  // Shinami ZK prover: creates the ZK proof from the JWT + ephemeral params
  const proofRes = await fetch('/api/zkproof', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jwt,
      maxEpoch,
      ephemeralPublicKey: ephemeralKey.getPublicKey().toBase64(),
      jwtRandomness: randomness,
      salt,
    }),
  });
  if (!proofRes.ok) {
    const err = await proofRes.json().catch(() => ({ error: proofRes.statusText })) as { error?: string };
    throw new Error(err.error ?? 'ZK proof fetch failed');
  }
  const zkProof = await proofRes.json();

  const user: ZkLoginSession = { address, sub, aud, email: claims.email, name: claims.name, picture: claims.picture };

  sessionStorage.setItem(KEYS.JWT, jwt);
  sessionStorage.setItem(KEYS.SALT, salt);
  sessionStorage.setItem(KEYS.ADDRESS, address);
  sessionStorage.setItem(KEYS.ZK_PROOF, JSON.stringify(zkProof));
  sessionStorage.setItem(KEYS.USER, JSON.stringify(user));

  // Set HTTP-only server session cookie so API routes can resolve the vault
  await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sub }),
  });

  return user;
}

export function getSession(): ZkLoginSession | null {
  try {
    const raw = sessionStorage.getItem(KEYS.USER);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ZkLoginSession;
    if (typeof parsed.sub !== 'string' || typeof parsed.aud !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getEphemeralKeypair(): Ed25519Keypair | null {
  const key = sessionStorage.getItem(KEYS.EPHEMERAL_KEY);
  return key ? Ed25519Keypair.fromSecretKey(key) : null;
}

export function getZkProof(): unknown {
  const raw = sessionStorage.getItem(KEYS.ZK_PROOF);
  return raw ? JSON.parse(raw) : null;
}

export function getMaxEpoch(): number {
  return Number(sessionStorage.getItem(KEYS.MAX_EPOCH) ?? 0);
}

export function getSalt(): string | null {
  return sessionStorage.getItem(KEYS.SALT);
}

export async function signOut(): Promise<void> {
  Object.values(KEYS).forEach((k) => sessionStorage.removeItem(k));
  await fetch('/api/auth/session', { method: 'DELETE' });
}

export async function isSessionValid(): Promise<boolean> {
  const session = getSession();
  if (!session) return false;
  const maxEpoch = getMaxEpoch();
  if (!maxEpoch) return false;
  try {
    const { epoch } = await getClient().getLatestSuiSystemState();
    return Number(epoch) < maxEpoch;
  } catch {
    return false;
  }
}

/**
 * Build the addressSeed string needed for getZkLoginSignature.
 * Shinami returns base64-encoded salt; must convert to BigInt via byte array.
 */
export function buildAddressSeed(): string {
  const session = getSession();
  const salt = getSalt();
  if (!session || !salt) throw new Error('Not authenticated');
  const saltBytes = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0));
  const saltBigInt = saltBytes.reduce((acc, byte) => (acc << 8n) + BigInt(byte), 0n);
  return genAddressSeed(saltBigInt, 'sub', session.sub, session.aud).toString();
}
