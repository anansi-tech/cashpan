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

import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { baseToHuman, COIN_SYMBOL } from './coin-config';
import { suiClient } from './sui';

const VENUE_ID = process.env.VENUE_ID ?? '';
const PACKAGE_ID = process.env.PACKAGE_ID ?? '';
const LENDING_MARKET_ID = process.env.LENDING_MARKET_ID ?? '';
const P_TYPE = process.env.P_TYPE ?? '';
const COIN_TYPE = process.env.COIN_TYPE ?? '';
const RESERVE_INDEX = Number(process.env.RESERVE_INDEX ?? '7');

// Balance<T> appears as {value: "123"} in some SDK versions, plain string in others.
function readBalance(field: unknown): bigint {
  if (field !== null && typeof field === 'object' && 'value' in (field as object)) {
    return BigInt((field as { value: string }).value);
  }
  return BigInt(String(field));
}

async function fetchSavingsValue(client: ReturnType<typeof suiClient>, vaultId: string): Promise<bigint> {
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

// ─── Suilend live APR ─────────────────────────────────────────────────────────

function interpolateApr(utils: number[], aprs: number[], utilizationPct: number): number {
  if (utilizationPct <= utils[0]) return aprs[0];
  if (utilizationPct >= utils[utils.length - 1]) return aprs[aprs.length - 1];
  for (let i = 1; i < utils.length; i++) {
    if (utilizationPct <= utils[i]) {
      const slope = (aprs[i] - aprs[i - 1]) / (utils[i] - utils[i - 1]);
      return aprs[i - 1] + slope * (utilizationPct - utils[i - 1]);
    }
  }
  return aprs[aprs.length - 1];
}

export async function getLiveAprBps(): Promise<number> {
  if (!LENDING_MARKET_ID) return 0;
  try {
    const client = suiClient();
    const obj = await client.getObject({ id: LENDING_MARKET_ID, options: { showContent: true } });
    if (obj.data?.content?.dataType !== 'moveObject') return 0;
    const topFields = obj.data.content.fields as Record<string, unknown>;
    const reserves = topFields.reserves as unknown[] | undefined;
    if (!Array.isArray(reserves) || reserves.length <= RESERVE_INDEX) return 0;

    const r = (reserves[RESERVE_INDEX] as Record<string, unknown>).fields as Record<string, unknown>;
    const ctokenSupply = BigInt(String(r.ctoken_supply ?? 0));
    const available = BigInt(String(r.available_amount ?? 0));
    const configEl = ((r.config as Record<string, unknown>)?.fields as Record<string, unknown>)?.element;
    const cfg = ((configEl as Record<string, unknown>)?.fields ?? {}) as Record<string, unknown>;
    const spreadFeeBps = Number(cfg.spread_fee_bps ?? 2000);
    const utils = cfg.interest_rate_utils as number[] ?? [0, 93, 97, 100];
    const aprs = (cfg.interest_rate_aprs as string[] ?? ['400', '700', '1500', '15000']).map(Number);

    // utilization: ctoken_supply ≈ total deposits; available = unlent portion
    const borrowed = ctokenSupply > available ? ctokenSupply - available : 0n;
    const utilizationPct = ctokenSupply > 0n ? Number((borrowed * 100n) / ctokenSupply) : 0;
    const borrowAprBps = interpolateApr(utils, aprs, utilizationPct);
    const supplyAprBps = Math.floor(borrowAprBps * (utilizationPct / 100) * (1 - spreadFeeBps / 10000));
    return supplyAprBps;
  } catch {
    return 0;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Balances {
  liquid: string;
  savingsValue: string;
  total: string;
  currentEpoch: string;
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
  const client = suiClient();

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
    savingsValue: savingsValue.toString(),
    total: (liquid + savingsValue).toString(),
    currentEpoch: currentEpoch.toString(),
  };
}

export async function getEarnings(vaultId: string, savingsPrincipalStr = '0'): Promise<Earnings> {
  const [balances, aprBps] = await Promise.all([getBalances(vaultId), getLiveAprBps()]);
  const savingsValue = BigInt(balances.savingsValue);
  const principal = BigInt(savingsPrincipalStr);
  const accrued = savingsValue > principal ? (savingsValue - principal).toString() : '0';
  return { accrued, aprBps: String(aprBps) };
}

export async function getAgentActivity(
  limit = 20,
  vaultId?: string,
  addressToName: Record<string, string> = {},
): Promise<ActivityEvent[]> {
  if (!PACKAGE_ID) return [];
  const client = suiClient();

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
  const client = suiClient();
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
