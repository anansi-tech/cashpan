/**
 * Google ID-token verification (server-only, no deps).
 *
 * The session mint endpoint MUST derive the sub from a token Google signed —
 * trusting a client-claimed sub let anyone mint a session for any account.
 * RS256 via Google's JWKS (cached 1h), plus iss / aud / exp checks.
 */

import { createPublicKey, verify as cryptoVerify } from 'crypto';
import type { JsonWebKey as NodeJwk } from 'crypto';

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const JWKS_TTL_MS = 60 * 60 * 1000;

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }

const g = globalThis as typeof globalThis & { _googleJwks?: { keys: Jwk[]; ts: number } };

async function getJwks(): Promise<Jwk[]> {
  if (!g._googleJwks || Date.now() - g._googleJwks.ts > JWKS_TTL_MS) {
    const res = await fetch(JWKS_URL, { cache: 'no-store' });
    const data = await res.json() as { keys?: Jwk[] };
    if (!data.keys?.length) throw new Error('Google JWKS fetch failed');
    g._googleJwks = { keys: data.keys, ts: Date.now() };
  }
  return g._googleJwks.keys;
}

const b64json = (s: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(s, 'base64url').toString());

/** Verified Google sub, or null for anything invalid. Never throws on bad input. */
export async function verifyGoogleIdToken(idToken: string): Promise<string | null> {
  try {
    const [h, p, s] = idToken.split('.');
    if (!h || !p || !s) return null;
    const header = b64json(h) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256' || !header.kid) return null;

    const jwk = (await getJwks()).find((k) => k.kid === header.kid);
    if (!jwk) return null;

    const key = createPublicKey({ key: jwk as unknown as NodeJwk, format: 'jwk' });
    const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
    if (!ok) return null;

    const claims = b64json(p) as { iss?: string; aud?: string; exp?: number; sub?: string };
    if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') return null;
    if (claims.aud !== process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) return null;
    if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    if (typeof claims.sub !== 'string' || !claims.sub) return null;

    return claims.sub;
  } catch {
    return null;
  }
}
