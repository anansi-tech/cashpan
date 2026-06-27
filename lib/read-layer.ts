/**
 * Server-side read layer. The only data source for the dashboard and chat.
 * No writes, no keys, no Transaction objects anywhere in this file.
 *
 * All functions take explicit vaultId — no VAULT_ID env reads in the request path.
 * VENUE_ID and PACKAGE_ID are shared across all vaults (single deployment).
 *
 * Mirrors computeCurrentValue from src/sense.ts — the two must stay in sync.
 */

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { baseToHuman, COIN_SYMBOL } from './coin-config';

const RPC_URL = process.env.SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443';
const VENUE_ID = process.env.VENUE_ID ?? '';

const PACKAGE_ID = process.env.PACKAGE_ID ?? '';

function makeClient(): SuiJsonRpcClient {
  return new SuiJsonRpcClient({ url: RPC_URL, network: 'testnet' });
}

// Mirrors src/sense.ts computeCurrentValue exactly.
function computeCurrentValue(
  principal: bigint,
  entryEpoch: bigint,
  rateBps: bigint,
  periodEpochs: bigint,
  currentEpoch: bigint,
): bigint {
  const elapsed = currentEpoch > entryEpoch ? currentEpoch - entryEpoch : 0n;
  if (elapsed === 0n || principal === 0n || periodEpochs === 0n) return principal;
  return principal + (principal * rateBps * elapsed) / (10_000n * periodEpochs);
}

// Balance<T> appears as {value: "123"} in some SDK versions, plain string in others.
function readBalance(field: unknown): bigint {
  if (field !== null && typeof field === 'object' && 'value' in (field as object)) {
    return BigInt((field as { value: string }).value);
  }
  return BigInt(String(field));
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

  const [vaultObj, venueObj, systemState] = await Promise.all([
    client.getObject({ id: vaultId, options: { showContent: true } }),
    client.getObject({ id: VENUE_ID, options: { showContent: true } }),
    client.getLatestSuiSystemState(),
  ]);

  if (vaultObj.data?.content?.dataType !== 'moveObject') throw new Error('Vault not found');
  if (venueObj.data?.content?.dataType !== 'moveObject') throw new Error('Venue not found');

  const vf = vaultObj.data.content.fields as Record<string, unknown>;
  const venf = venueObj.data.content.fields as Record<string, string>;
  const currentEpoch = BigInt(systemState.epoch);
  const rateBps = BigInt(venf.rate_bps);
  const periodEpochs = BigInt(venf.period_epochs);
  const liquid = readBalance(vf.liquid);

  // Option<Position> is null | {fields: ...} | {vec: [{fields: ...}]}
  const rawPos = vf.savings_position as
    | null
    | { fields: { principal: string; entry_epoch: string } }
    | { vec: Array<{ fields: { principal: string; entry_epoch: string } }> };

  let savingsPrincipal = 0n;
  let savingsValue = 0n;
  let entryEpoch = 0n;

  if (rawPos !== null) {
    const posFields =
      rawPos && 'vec' in rawPos
        ? (rawPos as { vec: Array<{ fields: { principal: string; entry_epoch: string } }> }).vec[0]?.fields
        : (rawPos as { fields: { principal: string; entry_epoch: string } }).fields;

    if (posFields) {
      savingsPrincipal = BigInt(posFields.principal);
      entryEpoch = BigInt(posFields.entry_epoch);
      savingsValue = computeCurrentValue(savingsPrincipal, entryEpoch, rateBps, periodEpochs, currentEpoch);
    }
  }

  return {
    liquid: liquid.toString(),
    savingsPrincipal: savingsPrincipal.toString(),
    savingsValue: savingsValue.toString(),
    total: (liquid + savingsValue).toString(),
    entryEpoch: entryEpoch.toString(),
    currentEpoch: currentEpoch.toString(),
    rateBps: rateBps.toString(),
    periodEpochs: periodEpochs.toString(),
  };
}

export async function getEarnings(vaultId: string): Promise<Earnings> {
  const balances = await getBalances(vaultId);
  const accrued = (BigInt(balances.savingsValue) - BigInt(balances.savingsPrincipal)).toString();
  return { accrued, aprBps: balances.rateBps };
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

export async function getConfig(vaultId: string): Promise<Config> {
  const client = makeClient();
  const vaultObj = await client.getObject({ id: vaultId, options: { showContent: true } });

  if (vaultObj.data?.content?.dataType !== 'moveObject') throw new Error('Vault not found');

  const vf = vaultObj.data.content.fields as Record<string, unknown>;

  return {
    buffer: process.env.BUFFER ?? '0',
    band: process.env.BAND ?? '0',
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
