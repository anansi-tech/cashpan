/**
 * Signed session cookie — THE single auth seam (server-only).
 *
 * Sealed HMAC-SHA256 token `base64url({sub,address,exp}).sig` under
 * SESSION_SECRET. Both the Google `sub` AND the zkLogin/payout `address` are
 * captured at mint (the address from Shinami, server-side, while the verified
 * JWT is in hand) — so no route ever trusts a client-supplied address. A cookie
 * missing either field (legacy raw-sub, or the earlier {sub}-only signed form)
 * fails verification → single clean re-login.
 *
 * Every authed route verifies through getAuthedSub()/getAuthedSession() —
 * one helper, no per-route drift.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export const SESSION_COOKIE = 'cashpan-sub';
export const SESSION_TTL_S = 7 * 24 * 3600; // matches the previous cookie maxAge

export interface SessionData {
  sub: string;
  /** Authenticated zkLogin/payout address (Shinami-derived at mint). */
  address: string;
}

function secret(): string {
  return process.env.SESSION_SECRET ?? '';
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Seal {sub, address, exp} into a signed cookie value. Throws if SESSION_SECRET unset. */
export function sealSession(sub: string, address: string, ttlSeconds = SESSION_TTL_S): string {
  if (!secret()) throw new Error('SESSION_SECRET not configured');
  if (!sub || !address) throw new Error('sealSession requires both sub and address');
  const payload = Buffer.from(
    JSON.stringify({ sub, address, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Verify a sealed cookie → {sub, address}, or null for anything invalid/expired/legacy. */
export function verifySessionCookie(value: string | undefined | null): SessionData | null {
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
    const { sub, address, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      sub?: string; address?: string; exp?: number;
    };
    if (typeof sub !== 'string' || !sub) return null;
    if (typeof address !== 'string' || !address) return null; // {sub}-only cookies → re-login
    if (typeof exp !== 'number' || exp <= Math.floor(Date.now() / 1000)) return null;
    return { sub, address };
  } catch {
    return null;
  }
}

function cookieValue(req: Request): string | null {
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Verified session {sub, address} from the request, or null. */
export function getAuthedSession(req: Request): SessionData | null {
  return verifySessionCookie(cookieValue(req));
}

/** Verified sub from the request, or null. */
export function getAuthedSub(req: Request): string | null {
  return getAuthedSession(req)?.sub ?? null;
}
