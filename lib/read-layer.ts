/**
 * Server-side read layer. The only data source for the dashboard and chat.
 * No writes, no keys, no Transaction objects anywhere in this file.
 *
 * All functions take explicit vaultId — no VAULT_ID env reads in the request path.
 * VENUE_ID and PACKAGE_ID are shared across all vaults (single deployment).
 *
 * Savings value is derived from vault::savings_balance via devInspect — Suilend
 * cToken ratio math runs on-chain, no local accrual formula needed.
 */

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { baseToHuman, COIN_SYMBOL } from './coin-config';

const RPC_URL = process.env.SUI_RPC_URL ?? 'https://fullnode.mainnet.sui.io:443';
const VENUE_ID = process.env.VENUE_ID ?? '';
const PACKAGE_ID = process.env.PACKAGE_ID ?? '';
const LENDING_MARKET_ID = process.env.LENDING_MARKET_ID ?? '';
const P_TYPE = process.env.P_TYPE ?? '';
const COIN_TYPE = process.env.COIN_TYPE ?? '';

function makeClient(): SuiJsonRpcClient {
  return new SuiJsonRpcClient({ url: RPC_URL, network: 'mainnet' });
}

// Balance<T> appears as {value: "123"} in some SDK versions, plain string in others.
function readBalance(field: unknown): bigint {
  if (field !== null && typeof field === 'object' && 'value' in (field as object)) {
    return BigInt((field as { value: string }).value);
  }
  return BigInt(String(field));
}

async function fetchSavingsValue(client: SuiJsonRpcClient, vaultId: string): Promise<bigint> {
  if (!PACKAGE_ID || !VENUE_ID || !LENDING_MARKET_ID || !P_TYPE || !COIN_TYPE) return 0n;
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::vault::savings_balance`,
      typeArguments: [P_TYPE, COIN_TYPE],
      arguments: [
        tx.object(vaultId),
        tx.object(VENUE_ID),
        tx.object(LENDING_MARKET_ID),
      ],
    });
    const result = await client.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
    });
    const bytes = result.results?.[0]?.returnValues?.[0]?.[0] as number[] | undefined;
    if (bytes) return BigInt(bcs.u64().parse(new Uint8Array(bytes)));
  } catch {
    // devInspect failed — no active savings position or env not configured
  }
  return 0n;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Balances {
  liquid: string;
  savingsPrincipal: string;
  savingsValue: string;
  total: string;
  entryEpoch: string;
  currentEpoch: string;
  rateBps: string;
  periodEpochs: string;
}

export interface Earnings {
  accrued: string;
  aprBps: string;
}

export interface ActivityEvent {
  type: 'rebalance' | 'withdraw' | 'send' | 'deposit';
  text: string;
  amount: string;
  direction?: number;
  byAgent?: boolean;
  to?: string;
  epochStr?: string;
  timestampMs?: string;
  digest: string;
}

export interface Config {
  buffer: string;
  band: string;
  perTxCap: string;
  dailyCap: string;
  outflowPerTxCap: string;
  outflowDailyCap: string;
  payoutAddress: string;
  packageId: string;
  vaultId: string;
  venueId: string;
}

// ─── Read functions ────────────────────────────────────────────────────────────

export async function getBalances(vaultId: string): Promise<Balances> {
  const client = makeClient();

  const [vaultObj, systemState] = await Promise.all([
    client.getObject({ id: vaultId, options: { showContent: true } }),
    client.getLatestSuiSystemState(),
  ]);

  if (vaultObj.data?.content?.dataType !== 'moveObject') throw new Error('Vault not found');

  const vf = vaultObj.data.content.fields as Record<string, unknown>;
  const currentEpoch = BigInt(systemState.epoch);
  const liquid = readBalance(vf.liquid);

  const savingsValue = await fetchSavingsValue(client, vaultId);

  return {
    liquid: liquid.toString(),
    savingsPrincipal: savingsValue.toString(),
    savingsValue: savingsValue.toString(),
    total: (liquid + savingsValue).toString(),
    entryEpoch: '0',
    currentEpoch: currentEpoch.toString(),
    rateBps: '0',
    periodEpochs: '1',
  };
}

export async function getEarnings(vaultId: string): Promise<Earnings> {
  const balances = await getBalances(vaultId);
  // accrued interest not directly trackable in cToken model without storing entry ratio
  return { accrued: '0', aprBps: '0' };
}

export async function getAgentActivity(
  limit = 20,
  vaultId?: string,
  addressToName: Record<string, string> = {},
): Promise<ActivityEvent[]> {
  if (!PACKAGE_ID) return [];
  const client = makeClient();

  const perType = Math.ceil(limit / 4) * 2;
  const eventTypes = [
    `${PACKAGE_ID}::vault::RebalanceEvent`,
    `${PACKAGE_ID}::vault::WithdrawEvent`,
    `${PACKAGE_ID}::vault::SendEvent`,
    `${PACKAGE_ID}::vault::DepositEvent`,
  ];

  const results = await Promise.allSettled(
    eventTypes.map((eventType) =>
      client.queryEvents({
        query: { MoveEventType: eventType },
        limit: perType,
        order: 'descending',
      }),
    ),
  );

  const events: ActivityEvent[] = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const ev of result.value.data) {
      const json = ev.parsedJson as Record<string, unknown> | undefined;
      if (!json) continue;
      // Filter to the resolved vault when specified
      if (vaultId && String(json.vault_id ?? '') !== vaultId) continue;
      const digest = (ev.id as { txDigest: string })?.txDigest ?? '';
      const timestampMs = (ev as { timestampMs?: string }).timestampMs;

      if (ev.type.endsWith('::RebalanceEvent')) {
        const direction = Number(json.direction ?? 0);
        const amount = String(json.amount ?? '0');
        const display = `$${baseToHuman(amount)}`;
        const text = direction === 0
          ? `Swept ${display} ${COIN_SYMBOL} to savings`
          : `Topped up ${display} ${COIN_SYMBOL} from savings`;
        events.push({
          type: 'rebalance',
          text,
          amount,
          direction,
          epochStr: String(json.epoch ?? ''),
          timestampMs,
          digest,
        });
      } else if (ev.type.endsWith('::WithdrawEvent')) {
        const amount = String(json.amount ?? '0');
        const display = `$${baseToHuman(amount)}`;
        const byAgent = Boolean(json.by_agent);
        const to = String(json.to ?? '');
        const text = byAgent
          ? `Agent moved ${display} ${COIN_SYMBOL} to payout address`
          : `Withdrew ${display} ${COIN_SYMBOL} to wallet`;
        events.push({ type: 'withdraw', text, amount, byAgent, to, timestampMs, digest });
      } else if (ev.type.endsWith('::SendEvent')) {
        const amount = String(json.amount ?? '0');
        const display = `$${baseToHuman(amount)}`;
        const byAgent = Boolean(json.by_agent);
        const to = String(json.to ?? '');
        const toLabel = addressToName[to.toLowerCase()] ?? (to.length > 12 ? `${to.slice(0, 6)}…${to.slice(-4)}` : to);
        const text = byAgent
          ? `Agent sent ${display} ${COIN_SYMBOL} to ${toLabel}`
          : `Sent ${display} ${COIN_SYMBOL} to ${toLabel}`;
        events.push({ type: 'send', text, amount, byAgent, to, timestampMs, digest });
      } else if (ev.type.endsWith('::DepositEvent')) {
        const amount = String(json.amount ?? '0');
        const display = `$${baseToHuman(amount)}`;
        events.push({ type: 'deposit', text: `Deposited ${display} ${COIN_SYMBOL}`, amount, timestampMs, digest });
      }
    }
  }

  events.sort((a, b) => Number(b.timestampMs ?? 0) - Number(a.timestampMs ?? 0));
  return events.slice(0, limit);
}

export async function getConfig(
  vaultId: string,
  userSettings?: { buffer?: string; band?: string },
): Promise<Config> {
  const client = makeClient();
  const vaultObj = await client.getObject({ id: vaultId, options: { showContent: true } });

  if (vaultObj.data?.content?.dataType !== 'moveObject') throw new Error('Vault not found');

  const vf = vaultObj.data.content.fields as Record<string, unknown>;

  return {
    buffer: userSettings?.buffer ?? '50',
    band: userSettings?.band ?? '5',
    perTxCap: String(vf.per_tx_cap ?? '0'),
    dailyCap: String(vf.daily_cap ?? '0'),
    outflowPerTxCap: String(vf.outflow_per_tx_cap ?? '0'),
    outflowDailyCap: String(vf.outflow_daily_cap ?? '0'),
    payoutAddress: String(vf.payout_address ?? ''),
    packageId: PACKAGE_ID,
    vaultId,
    venueId: VENUE_ID,
  };
}
