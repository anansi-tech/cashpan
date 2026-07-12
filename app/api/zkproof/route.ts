import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Unauthenticated by necessity (login flow) — rate-limit guards the paid,
// compute-heavy Shinami zkProver against quota-burn.
export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, 'zkproof', 20, 60_000);
  if (limited) return limited;
  try {
    const { jwt, maxEpoch, ephemeralPublicKey, jwtRandomness, salt } =
      await req.json() as {
        jwt: string;
        maxEpoch: number;
        ephemeralPublicKey: string;
        jwtRandomness: string;
        salt: string;
      };

    const apiKey = process.env.SHINAMI_ZKLOGIN_KEY;
    if (!apiKey) {
      console.error('[zkproof] SHINAMI_ZKLOGIN_KEY is not set');
      return NextResponse.json({ error: 'SHINAMI_ZKLOGIN_KEY not configured' }, { status: 500 });
    }

    const res = await fetch('https://api.us1.shinami.com/sui/zkprover/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'shinami_zkp_createZkLoginProof',
        params: [jwt, String(maxEpoch), ephemeralPublicKey, jwtRandomness, salt],
        id: 1,
      }),
    });

    const data = await res.json() as { result?: { zkProof: unknown }; error?: { message: string; data?: unknown } };
    // Do NOT log the response — it contains the zkProof (auth artifact).
    if (data.error) {
      console.error('[zkproof] Shinami error:', res.status, data.error.message);
      return NextResponse.json({ error: data.error.message, detail: data.error.data }, { status: 400 });
    }

    return NextResponse.json(data.result!.zkProof);
  } catch (err) {
    console.error('[zkproof] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
