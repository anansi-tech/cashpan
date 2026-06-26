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

    const res = await fetch('https://api.us1.shinami.com/sui/zkprover/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey! },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'shinami_zkp_createZkLoginProof',
        params: [jwt, maxEpoch, ephemeralPublicKey, jwtRandomness, salt],
        id: 1,
      }),
    });

    const data = await res.json() as { result?: { zkProof: unknown }; error?: { message: string } };
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 });

    return NextResponse.json(data.result!.zkProof);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
