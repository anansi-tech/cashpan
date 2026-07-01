/**
 * Centralized Sui RPC surface. Import suiClient() everywhere instead of
 * constructing SuiJsonRpcClient directly.
 *
 * getCoinsRaw() bypasses the SDK's getCoins wrapper, which silently returns []
 * at @mysten/sui@2.15 even when the fullnode has the coin. Raw suix_getCoins
 * over fetch is proven correct on mainnet.
 */

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';

export const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet';

const RPC_URL =
  process.env.SUI_RPC_URL ??
  (NETWORK === 'mainnet'
    ? 'https://fullnode.mainnet.sui.io:443'
    : 'https://fullnode.testnet.sui.io:443');

export function suiClient(): SuiJsonRpcClient {
  return new SuiJsonRpcClient({ url: RPC_URL, network: NETWORK });
}

export async function getCoinsRaw(
  owner: string,
  coinType: string,
): Promise<Array<{ coinObjectId: string; balance: string }>> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'suix_getCoins',
      params: [owner, coinType, null, 50],
    }),
  });
  const json = await res.json() as {
    result?: { data?: Array<{ coinObjectId: string; balance: string }> };
    error?: { message: string };
  };
  if (json.error) throw new Error(`suix_getCoins: ${json.error.message}`);
  return json.result?.data ?? [];
}

export function suiNetwork(): 'mainnet' | 'testnet' {
  return NETWORK;
}
