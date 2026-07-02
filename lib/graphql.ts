/**
 * GraphQL + SuilendClient read layer.
 *
 * fetchVaultState() collapses vault object + wallet coins + epoch into one
 * GraphQL POST. getLiveAprBps() uses SuilendClient (no RESERVE_INDEX or
 * LENDING_MARKET_ID env vars needed — both come from @suilend/sdk).
 *
 * SuilendClient is cached in globalThis so warm serverless instances skip
 * re-initialization. Cold starts pay the one extra GraphQL call for market init.
 */

import { SuiGraphQLClient } from '@mysten/sui/graphql';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { SuilendClient, LENDING_MARKET_ID, LENDING_MARKET_TYPE } from '@suilend/sdk/client';
import { calculateDepositAprPercent } from '@suilend/sdk/utils/simulate';
import { NETWORK } from './sui';
import type { WalletCoin } from './brain';

const GRAPHQL_URL  = process.env.SUI_GRAPHQL_URL ?? '';
const GRPC_TOKEN   = process.env.SUI_GRPC_TOKEN ?? '';
const AUTH_HEADER  = process.env.SUI_GRPC_AUTH_HEADER ?? '';
const COIN_TYPE    = process.env.COIN_TYPE ?? '';

// Re-export so other modules don't need to import @suilend/sdk directly.
export { LENDING_MARKET_ID };

// ─── Clients ──────────────────────────────────────────────────────────────────

export function graphqlClient(): SuiGraphQLClient {
  return new SuiGraphQLClient({
    url: GRAPHQL_URL,
    headers: { [AUTH_HEADER]: GRPC_TOKEN },
    network: NETWORK,
  });
}

// Warm cache for SuilendClient — avoids re-fetching the lending market object
// on every request in warm serverless instances.
const g = globalThis as typeof globalThis & {
  _suilendCache?: { client: SuilendClient; ts: number };
};
const SUILEND_TTL_MS = 5 * 60 * 1000;

async function getSuilendClient(): Promise<SuilendClient> {
  const now = Date.now();
  if (!g._suilendCache || now - g._suilendCache.ts > SUILEND_TTL_MS) {
    const client = await SuilendClient.initialize(
      LENDING_MARKET_ID,
      LENDING_MARKET_TYPE,
      graphqlClient() as unknown as SuiGrpcClient,
    );
    g._suilendCache = { client, ts: now };
  }
  return g._suilendCache.client;
}

// ─── APR ──────────────────────────────────────────────────────────────────────

export async function getLiveAprBps(coinType = COIN_TYPE): Promise<number> {
  if (!coinType) return 0;
  try {
    const suilend = await getSuilendClient();
    const idx = suilend.findReserveArrayIndex(coinType);
    if (idx < 0n) return 0;
    const reserve = suilend.lendingMarket.reserves[Number(idx)];
    // calculateDepositAprPercent returns a BigNumber percent (e.g. 3.52 = 3.52%)
    const aprPct = calculateDepositAprPercent(reserve);
    return Math.floor(aprPct.toNumber() * 100); // → BPS
  } catch {
    return 0;
  }
}

// ─── Combined vault state query ───────────────────────────────────────────────

export interface VaultStateGQL {
  liquidBase: bigint;
  walletCoins: WalletCoin[];
  currentEpoch: bigint;
}

type GQLNode = { address: string; balance?: { totalBalance: string } };

type GQLData = {
  epoch?: { epochId?: string };
  vault?: { asMoveObject?: { contents?: { json?: Record<string, unknown> } } };
  wallet?: { objects?: { nodes?: GQLNode[] } };
};

export async function fetchVaultState(
  vaultId: string,
  payoutAddress: string,
  coinType: string,
): Promise<VaultStateGQL> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: GRPC_TOKEN },
    body: JSON.stringify({
      query: `{
        epoch { epochId }
        vault: object(address: "${vaultId}") {
          asMoveObject { contents { json } }
        }
        wallet: address(address: "${payoutAddress}") {
          objects(first: 50, filter: { type: "${coinType}" }) {
            nodes {
              address
              balance(coinType: "${coinType}") { totalBalance }
            }
          }
        }
      }`,
    }),
  });

  const json = await res.json() as { data?: GQLData; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`GraphQL: ${json.errors[0].message}`);
  if (!json.data) throw new Error('GraphQL returned no data');

  const { epoch, vault, wallet } = json.data;

  const currentEpoch = BigInt(epoch?.epochId ?? 0);

  const vaultJson = vault?.asMoveObject?.contents?.json;
  if (!vaultJson) throw new Error(`Vault object not found: ${vaultId}`);
  const liquidBase = readLiquidBase(vaultJson);

  const nodes = wallet?.objects?.nodes ?? [];
  const walletCoins: WalletCoin[] = nodes.map((n) => ({
    coinObjectId: n.address,
    balance: n.balance?.totalBalance ?? '0',
  }));

  return { liquidBase, walletCoins, currentEpoch };
}

// ─── Minimal vault query (liquid + epoch + payoutAddress, no wallet coins) ────

export interface VaultBasic {
  liquid: bigint;
  currentEpoch: bigint;
  payoutAddress: string;
}

export async function fetchVaultBasic(vaultId: string): Promise<VaultBasic> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: GRPC_TOKEN },
    body: JSON.stringify({
      query: `{
        epoch { epochId }
        vault: object(address: "${vaultId}") {
          asMoveObject { contents { json } }
        }
      }`,
    }),
  });
  const json = await res.json() as { data?: GQLData; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`GraphQL: ${json.errors[0].message}`);
  if (!json.data) throw new Error('GraphQL returned no data');
  const { epoch, vault } = json.data;
  const vaultJson = vault?.asMoveObject?.contents?.json;
  if (!vaultJson) throw new Error(`Vault object not found: ${vaultId}`);
  return {
    liquid: readLiquidBase(vaultJson),
    currentEpoch: BigInt(epoch?.epochId ?? 0),
    payoutAddress: String(vaultJson.payout_address ?? ''),
  };
}

// ─── Raw vault JSON (all fields, no epoch) ────────────────────────────────────

export async function fetchVaultJson(vaultId: string): Promise<Record<string, unknown>> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: GRPC_TOKEN },
    body: JSON.stringify({
      query: `{ vault: object(address: "${vaultId}") { asMoveObject { contents { json } } } }`,
    }),
  });
  const json = await res.json() as { data?: Pick<GQLData, 'vault'>; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`GraphQL: ${json.errors[0].message}`);
  const vaultJson = json.data?.vault?.asMoveObject?.contents?.json;
  if (!vaultJson) throw new Error(`Vault object not found: ${vaultId}`);
  return vaultJson;
}

// ─── Event querying ────────────────────────────────────────────────────────────

export interface GQLEventNode {
  json: Record<string, unknown> | null;
  timestamp: string | null;
  type: { repr: string } | null;
  transactionBlock: { digest: string } | null;
}

export async function fetchEventsGQL(
  eventType: string,
  last = 20,
): Promise<GQLEventNode[]> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: GRPC_TOKEN },
    body: JSON.stringify({
      query: `{
        events(filter: { eventType: "${eventType}" }, last: ${last}) {
          nodes { json timestamp type { repr } transactionBlock { digest } }
        }
      }`,
    }),
  });
  const data = await res.json() as {
    data?: { events?: { nodes?: GQLEventNode[] } };
    errors?: { message: string }[];
  };
  if (data.errors?.length) throw new Error(`GraphQL events: ${data.errors[0].message}`);
  return data.data?.events?.nodes ?? [];
}

// ─── Coin objects by type (for mergeCoins in sweep PTBs) ─────────────────────

export async function getCoinsByType(
  owner: string,
  coinType: string,
): Promise<WalletCoin[]> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: GRPC_TOKEN },
    body: JSON.stringify({
      query: `{
        address(address: "${owner}") {
          objects(first: 50, filter: { type: "${coinType}" }) {
            nodes {
              address
              balance(coinType: "${coinType}") { totalBalance }
            }
          }
        }
      }`,
    }),
  });
  const data = await res.json() as {
    data?: { address?: { objects?: { nodes?: GQLNode[] } } };
    errors?: { message: string }[];
  };
  if (data.errors?.length) throw new Error(`GraphQL coins: ${data.errors[0].message}`);
  const nodes = data.data?.address?.objects?.nodes ?? [];
  return nodes.map((n) => ({
    coinObjectId: n.address,
    balance: n.balance?.totalBalance ?? '0',
  }));
}

// Balance<T> arrives as a plain numeric string in GraphQL JSON (not {value:...}).
function readLiquidBase(vaultJson: Record<string, unknown>): bigint {
  const liquid = vaultJson.liquid;
  if (typeof liquid === 'object' && liquid !== null && 'value' in (liquid as object)) {
    return BigInt((liquid as { value: string }).value);
  }
  return BigInt(String(liquid ?? 0));
}
