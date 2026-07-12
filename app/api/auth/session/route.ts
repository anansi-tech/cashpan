import { NextResponse } from 'next/server';
import { verifyGoogleIdToken } from '@/lib/google-id-token';
import { getOrCreateZkLoginWallet } from '@/lib/shinami-zkwallet';
import { sealSession, verifySessionCookie, SESSION_COOKIE, SESSION_TTL_S } from '@/lib/session';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// POST /api/auth/session — mint the signed session cookie after OAuth callback.
// Both {sub, address} are captured server-side here — the sub from the verified
// Google id_token, the zkLogin address from Shinami (idempotent per sub) — so
// no downstream route ever trusts a client-supplied address.
export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, 'auth-mint', 20, 60_000);
  if (limited) return limited;

  const { jwt } = await req.json().catch(() => ({})) as { jwt?: string };
  if (!jwt) return NextResponse.json({ error: 'id_token required' }, { status: 401 });

  const sub = await verifyGoogleIdToken(jwt);
  if (!sub) return NextResponse.json({ error: 'Invalid id_token' }, { status: 401 });

  // Derive the authenticated address. If Shinami fails, FAIL the login — never
  // seal {sub} without an address (that would reintroduce the null-address path).
  let address: string;
  try {
    ({ address } = await getOrCreateZkLoginWallet(jwt));
  } catch (err) {
    console.error('[/api/auth/session] zkWallet derivation failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not establish your wallet — try signing in again' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sealSession(sub, address), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_S,
  });
  return res;
}

// GET /api/auth/session — client checks whether a VALID server session exists
export async function GET(req: Request) {
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  const has_session = verifySessionCookie(m ? decodeURIComponent(m[1]) : null) !== null;
  return NextResponse.json({ has_session });
}

// DELETE /api/auth/session — clear cookie on sign out
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
