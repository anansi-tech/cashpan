import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
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

    console.log('[zkproof] sending to Shinami:', {
      maxEpoch,
      ephemeralPublicKey: ephemeralPublicKey.slice(0, 20) + '…',
      jwtRandomness: jwtRandomness?.slice(0, 10) + '…',
      salt: salt?.slice(0, 10) + '…',
    });

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
    console.log('[zkproof] Shinami HTTP status:', res.status);
    console.log('[zkproof] Shinami response:', JSON.stringify(data));

    if (data.error) {
      return NextResponse.json({ error: data.error.message, detail: data.error.data }, { status: 400 });
    }

    return NextResponse.json(data.result!.zkProof);
  } catch (err) {
    console.error('[zkproof] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
