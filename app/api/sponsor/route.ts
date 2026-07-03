import { NextResponse } from 'next/server';
import { Transaction } from '@mysten/sui/transactions';
import { graphqlClient } from '@/lib/graphql';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    // Client serializes the Transaction (PTB commands only, no network needed).
    // We build it server-side so the GraphQL client can resolve object versions.
    const { txSerialized, sender } = await req.json() as { txSerialized: string; sender: string };
    const apiKey = process.env.SHINAMI_GAS_STATION_KEY!;

    const tx = Transaction.from(txSerialized);
    tx.setSender(sender);
    const kindBytes = await tx.build({ client: graphqlClient(), onlyTransactionKind: true });
    const txBase64 = Buffer.from(kindBytes).toString('base64');

    const res = await fetch('https://api.us1.shinami.com/sui/gas/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'gas_sponsorTransactionBlock',
        params: [txBase64, sender],
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
