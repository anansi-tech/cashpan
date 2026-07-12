import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Unauthenticated by necessity (part of establishing the session) — rate-limit
// is the only guard against Shinami zkWallet quota-burn.
export async function POST(req: Request) {
  const limited = enforceRateLimit(req, 'salt', 20, 60_000);
  if (limited) return limited;
  try {
    const { jwt } = await req.json() as { jwt: string };
    const apiKey = process.env.SHINAMI_ZKLOGIN_KEY;

    const res = await fetch('https://api.us1.shinami.com/sui/zkwallet/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey! },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'shinami_zkw_getOrCreateZkLoginWallet',
        params: [jwt],
        id: 1,
      }),
    });

    const data = await res.json() as { result?: { salt: string; address: string }; error?: { message: string } };
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 });

    return NextResponse.json({ salt: data.result!.salt, address: data.result!.address });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
