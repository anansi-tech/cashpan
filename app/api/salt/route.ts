import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
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
