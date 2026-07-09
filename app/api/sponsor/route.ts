import { NextResponse } from 'next/server';
import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient, JsonRpcHTTPTransport } from '@mysten/sui/jsonRpc';
import { NETWORK } from '@/lib/sui';
import { buildDepositTx } from '@/lib/vault-tx';

// Derive JSON-RPC URL from the GraphQL URL (same QuickNode endpoint, different path).
// suix_getCoins JSON-RPC is authoritative for coin enumeration; GraphQL address.objects
// returns empty for some coin types on QuickNode.
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

type RegularBody = { txSerialized: string; sender: string };
type DepositBody = { action: 'deposit'; amountBase: string; sender: string; vaultId: string; packageId: string; coinType: string };

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json() as RegularBody | DepositBody;
    const apiKey = process.env.SHINAMI_GAS_STATION_KEY!;

    let tx: Transaction;

    if ('action' in body && body.action === 'deposit') {
      // Server builds deposit PTB — coinWithBalance intent resolved here via suix_getCoins.
      const { amountBase, sender, vaultId, packageId, coinType } = body;
      tx = buildDepositTx(BigInt(amountBase), { packageId, coinType, vaultId });
      tx.setSender(sender);
    } else {
      // Client serialized a plain object-ref PTB (sweep/topup/send/withdraw).
      const { txSerialized, sender } = body as RegularBody;
      tx = Transaction.from(txSerialized);
      tx.setSender(sender);
    }

    const kindBytes = await tx.build({ client: rpcClient(), onlyTransactionKind: true });
    const txBase64 = Buffer.from(kindBytes).toString('base64');
    const sender = body.sender;

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
      console.error('[/api/sponsor] Shinami error:', msg);
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    if (!data.result?.txBytes || !data.result?.signature) {
      const raw = JSON.stringify(data).slice(0, 500);
      console.error('[/api/sponsor] unexpected Shinami response (no result):', raw);
      return NextResponse.json({ error: `Unexpected sponsorship response: ${raw}` }, { status: 502 });
    }

    return NextResponse.json(data.result);
  } catch (err) {
    console.error('[/api/sponsor] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
