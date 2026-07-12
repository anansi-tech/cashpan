import { NextResponse } from 'next/server';
import { verifyGoogleIdToken } from '@/lib/google-id-token';
import { sealSession, verifySessionCookie, SESSION_COOKIE, SESSION_TTL_S } from '@/lib/session';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// POST /api/auth/session — mint the signed session cookie after OAuth callback.
// The sub comes ONLY from a Google-signed id_token verified server-side; a
// client-claimed sub is never trusted (the old {sub} body minted sessions for
// any account — see CDP finding).
export async function POST(req: Request) {
  const limited = enforceRateLimit(req, 'auth-mint', 20, 60_000);
  if (limited) return limited;

  const { jwt } = await req.json().catch(() => ({})) as { jwt?: string };
  if (!jwt) return NextResponse.json({ error: 'id_token required' }, { status: 401 });

  const sub = await verifyGoogleIdToken(jwt);
  if (!sub) return NextResponse.json({ error: 'Invalid id_token' }, { status: 401 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sealSession(sub), {
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
