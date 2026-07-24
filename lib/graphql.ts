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
import { gqlPost } from './gql-fetch';

const GRAPHQL_URL  = process.env.SUI_GRAPHQL_URL ?? '';
const GRPC_TOKEN   = process.env.SUI_GRPC_TOKEN ?? '';
const AUTH_HEADER  = process.env.SUI_GRPC_AUTH_HEADER ?? '';
const COIN_TYPE    = process.env.COIN_TYPE ?? '';

// Re-export so other modules don't need to import @suilend/sdk directly.
export { LENDING_MARKET_ID, LENDING_MARKET_TYPE };

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
  walletBalance: string;
  currentEpoch: bigint;
}

type GQLData = {
  epoch?: { epochId?: string };
  vault?: { asMoveObject?: { contents?: { json?: Record<string, unknown> } } };
  wallet?: { balance?: { totalBalance?: string } | null };
};

export async function fetchVaultState(
  vaultId: string,
  payoutAddress: string,
  coinType: string,
): Promise<VaultStateGQL> {
  const data = await gqlPost<GQLData>(`{
    epoch { epochId }
    vault: object(address: "${vaultId}") {
      asMoveObject { contents { json } }
    }
    wallet: address(address: "${payoutAddress}") {
      balance(coinType: "${coinType}") { totalBalance }
    }
  }`, 'vaultState');

  const { epoch, vault, wallet } = data;
  const currentEpoch = BigInt(epoch?.epochId ?? 0);
  const vaultJson = vault?.asMoveObject?.contents?.json;
  if (!vaultJson) throw new Error(`Vault object not found: ${vaultId}`);
  const walletBalance = wallet?.balance?.totalBalance ?? '0';

  return { liquidBase: readLiquidBase(vaultJson), walletBalance, currentEpoch };
}

export async function fetchWalletBalance(address: string, coinType: string): Promise<string> {
  const data = await gqlPost<{ wallet?: { balance?: { totalBalance?: string } | null } }>(`{
    wallet: address(address: "${address}") {
      balance(coinType: "${coinType}") { totalBalance }
    }
  }`, 'walletBalance');
  return data.wallet?.balance?.totalBalance ?? '0';
}

// ─── Minimal vault query (liquid + epoch + payoutAddress, no wallet coins) ────

export interface VaultBasic {
  liquid: bigint;
  currentEpoch: bigint;
  payoutAddress: string;
  /** The full vault object JSON the query already fetched — callers needing
      more fields (outflow caps, allowlist) read it here instead of re-querying. */
  json: Record<string, unknown>;
}

export async function fetchVaultBasic(vaultId: string): Promise<VaultBasic> {
  const data = await gqlPost<GQLData>(`{
    epoch { epochId }
    vault: object(address: "${vaultId}") {
      asMoveObject { contents { json } }
    }
  }`, 'vaultBasic');
  const { epoch, vault } = data;
  const vaultJson = vault?.asMoveObject?.contents?.json;
  if (!vaultJson) throw new Error(`Vault object not found: ${vaultId}`);
  return {
    liquid: readLiquidBase(vaultJson),
    currentEpoch: BigInt(epoch?.epochId ?? 0),
    payoutAddress: String(vaultJson.payout_address ?? ''),
    json: vaultJson,
  };
}

// ─── Raw vault JSON (all fields, no epoch) ────────────────────────────────────

export async function fetchVaultJson(vaultId: string): Promise<Record<string, unknown>> {
  const data = await gqlPost<Pick<GQLData, 'vault'>>(
    `{ vault: object(address: "${vaultId}") { asMoveObject { contents { json } } } }`,
    'vaultJson',
  );
  const vaultJson = data.vault?.asMoveObject?.contents?.json;
  if (!vaultJson) throw new Error(`Vault object not found: ${vaultId}`);
  return vaultJson;
}

// ─── Event querying ────────────────────────────────────────────────────────────

// QuickNode Sui GraphQL schema (differs from Mysten Labs reference):
//   filter field: `type` (not `eventType`)
//   event data:   `contents { json }` (not top-level `json`)
//   tx reference: `transaction { digest }` (not `transactionBlock`)
export interface GQLEventNode {
  contents: { json: Record<string, unknown> | null } | null;
  timestamp: string | null;
  transaction: { digest: string } | null;
  /** Event sender — the on-chain fact used to attribute autopilot actions. */
  sender: { address: string } | null;
}

export async function fetchEventsGQL(
  eventType: string,
  last = 20,
): Promise<GQLEventNode[]> {
  const data = await gqlPost<{ events?: { nodes?: GQLEventNode[] } }>(`{
    events(filter: { type: "${eventType}" }, last: ${last}) {
      nodes { contents { json } timestamp transaction { digest } sender { address } }
    }
  }`, 'events');
  return data.events?.nodes ?? [];
}

export interface PackageEventsPage {
  events: GQLEventNode[];
  /** Cursor to continue paging; null when this was the last page. */
  nextCursor: string | null;
  /** Cursor of the last event in this page (set even on the last page) — for checkpointing. */
  endCursor: string | null;
}

export async function queryPackageEvents(
  eventType: string,
  cursor: string | null = null,
  limit = 50,
): Promise<PackageEventsPage> {
  const afterClause = cursor ? `, after: ${JSON.stringify(cursor)}` : '';
  const data = await gqlPost<{
    events?: {
      nodes?: GQLEventNode[];
      pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
    };
  }>(`{
    events(filter: { type: "${eventType}" }, first: ${limit}${afterClause}) {
      nodes { contents { json } timestamp transaction { digest } sender { address } }
      pageInfo { hasNextPage endCursor }
    }
  }`, 'packageEvents');
  const nodes = data.events?.nodes ?? [];
  const pageInfo = data.events?.pageInfo;
  const endCursor = pageInfo?.endCursor ?? null;
  const nextCursor = pageInfo?.hasNextPage ? endCursor : null;
  return { events: nodes, nextCursor, endCursor };
}

// ─── OwnerCap lookup (idempotent provision) ───────────────────────────────────

export async function findOwnedOwnerCap(
  address: string,
  packageId: string,
): Promise<{ ownerCapId: string; vaultId: string } | null> {
  const data = await gqlPost<{
    address?: { objects?: { nodes?: Array<{ address: string; contents?: { json?: Record<string, unknown> | null } | null }> } };
  }>(`{
    address(address: "${address}") {
      objects(first: 1, filter: { type: "${packageId}::vault::OwnerCap" }) {
        nodes { address contents { json } }
      }
    }
  }`, 'ownerCap');
  const node = data.address?.objects?.nodes?.[0];
  if (!node) return null;
  const vaultId = String(node.contents?.json?.vault_id ?? '');
  if (!vaultId) return null;
  return { ownerCapId: node.address, vaultId };
}

// ─── Coin objects by type (supplement — use fetchWalletBalance for display) ───

type CoinObjNode = {
  address: string;
  contents?: { json?: Record<string, unknown> | null } | null;
};

export async function getCoinsByType(
  owner: string,
  coinType: string,
): Promise<{ coinObjectId: string; balance: string }[]> {
  const data = await gqlPost<{ address?: { objects?: { nodes?: CoinObjNode[] } } }>(`{
    address(address: "${owner}") {
      objects(first: 50, filter: { type: "0x2::coin::Coin<${coinType}>" }) {
        nodes { address contents { json } }
      }
    }
  }`, 'coins');
  return (data.address?.objects?.nodes ?? []).map((n) => ({
    coinObjectId: n.address,
    balance: parseCoinBalance(n.contents?.json),
  }));
}

// Coin<T> MoveObject JSON: { balance: "12345" } or { balance: { value: "12345" } }
function parseCoinBalance(json: Record<string, unknown> | null | undefined): string {
  const bal = json?.balance;
  if (typeof bal === 'object' && bal !== null && 'value' in (bal as object)) {
    return String((bal as { value: string }).value);
  }
  return String(bal ?? '0');
}

// Balance<T> arrives as a plain numeric string in GraphQL JSON (not {value:...}).
function readLiquidBase(vaultJson: Record<string, unknown>): bigint {
  const liquid = vaultJson.liquid;
  if (typeof liquid === 'object' && liquid !== null && 'value' in (liquid as object)) {
    return BigInt((liquid as { value: string }).value);
  }
  return BigInt(String(liquid ?? 0));
}
