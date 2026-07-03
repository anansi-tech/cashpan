import { NextResponse } from 'next/server';
import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient, JsonRpcHTTPTransport } from '@mysten/sui/jsonRpc';
import { NETWORK } from '@/lib/sui';

// Derive JSON-RPC URL from the GraphQL URL (same QuickNode endpoint, different path).
// SuiGraphQLClient.core.listCoins() uses address.objects which QuickNode returns empty for
// some coin types; suix_getCoins JSON-RPC is authoritative and resolves coinWithBalance correctly.
const GRAPHQL_URL = process.env.SUI_GRAPHQL_URL ?? '';
const RPC_URL = GRAPHQL_URL.replace(/\/graphql\/?$/, '');
const GRPC_TOKEN = process.env.SUI_GRPC_TOKEN ?? '';
const AUTH_HEADER = process.env.SUI_GRPC_AUTH_HEADER ?? 'x-token';

function rpcClient() {
  return new SuiJsonRpcClient({
    network: NETWORK,
    transport: new JsonRpcHTTPTransport({
      url: RPC_URL,
      rpc: { url: RPC_URL, headers: { [AUTH_HEADER]: GRPC_TOKEN } },
    }),
  });
}

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    // Client serializes the Transaction (PTB commands only, no network needed).
    // We build server-side so the JSON-RPC client can resolve object versions + coin intents.
    const { txSerialized, sender } = await req.json() as { txSerialized: string; sender: string };
    const apiKey = process.env.SHINAMI_GAS_STATION_KEY!;

    const tx = Transaction.from(txSerialized);
    tx.setSender(sender);
    const kindBytes = await tx.build({ client: rpcClient(), onlyTransactionKind: true });
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
    console.error('[/api/sponsor] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
