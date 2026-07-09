import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

// POST /api/auth/session  — set cashpan-sub HTTP-only cookie after OAuth callback
export async function POST(req: Request) {
  const { sub } = await req.json() as { sub: string };
  if (!sub) return NextResponse.json({ error: 'sub required' }, { status: 400 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set('cashpan-sub', sub, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return res;
}

// GET /api/auth/session  — client checks whether server cookie is still set
export async function GET() {
  const cookieStore = await cookies();
  const has_session = !!cookieStore.get('cashpan-sub')?.value;
  return NextResponse.json({ has_session });
}

// DELETE /api/auth/session  — clear cookie on sign out
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('cashpan-sub');
  return res;
}
