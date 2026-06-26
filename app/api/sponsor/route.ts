import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { txBytes, sender } = await req.json() as { txBytes: string; sender: string };
    const apiKey = process.env.SHINAMI_GAS_STATION_KEY!;

    const res = await fetch('https://api.us1.shinami.com/sui/gas/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'gas_sponsorTransactionBlock',
        params: [txBytes, sender],
        id: 1,
      }),
    });

    const data = await res.json() as {
      result?: { txBytes: string; signature: string };
      error?: { message: string; data?: { details?: string } };
    };

    if (data.error) {
      const details = data.error.data?.details;
      const msg = details ? `${data.error.message}: ${details}` : data.error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    return NextResponse.json(data.result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
