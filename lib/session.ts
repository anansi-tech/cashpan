/**
 * Signed session cookie — THE single auth seam (server-only).
 *
 * Replaces the raw-sub cookie, which was forgeable: any client that knew a
 * target's Google sub could mint a session (and /api/auth/session even set
 * whatever sub the client claimed). The cookie is now an HMAC-SHA256 sealed
 * token `base64url({sub,exp}).sig` under SESSION_SECRET. Every authed route
 * verifies through getAuthedSub()/verifySessionCookie() — one helper, no
 * per-route drift. Old raw cookies fail verification (single re-login).
 */

import { createHmac, timingSafeEqual } from 'crypto';

export const SESSION_COOKIE = 'cashpan-sub';
export const SESSION_TTL_S = 7 * 24 * 3600; // matches the previous cookie maxAge

function secret(): string {
  return process.env.SESSION_SECRET ?? '';
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Seal {sub, exp} into a signed cookie value. Throws if SESSION_SECRET unset. */
export function sealSession(sub: string, ttlSeconds = SESSION_TTL_S): string {
  if (!secret()) throw new Error('SESSION_SECRET not configured');
  const payload = Buffer.from(
    JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Verify a sealed cookie value → sub, or null for anything invalid/expired/legacy. */
export function verifySessionCookie(value: string | undefined | null): string | null {
  if (!value || !secret()) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null; // includes legacy raw-sub cookies — invalid by construction

  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: string; exp?: number };
    if (typeof sub !== 'string' || !sub) return null;
    if (typeof exp !== 'number' || exp <= Math.floor(Date.now() / 1000)) return null;
    return sub;
  } catch {
    return null;
  }
}

/** The one helper every authed route uses: verified sub from the request, or null. */
export function getAuthedSub(req: Request): string | null {
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return verifySessionCookie(m ? decodeURIComponent(m[1]) : null);
}
