import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getOrCreateZkLoginWallet } from '@/lib/shinami-zkwallet';

export const dynamic = 'force-dynamic';

// Unauthenticated by necessity (part of establishing the session) — rate-limit
// is the only guard against Shinami zkWallet quota-burn.
export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, 'salt', 20, 60_000);
  if (limited) return limited;
  try {
    const { jwt } = await req.json() as { jwt: string };
    const { salt, address } = await getOrCreateZkLoginWallet(jwt);
    return NextResponse.json({ salt, address });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
