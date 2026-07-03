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
import { getLiveAprBps, LENDING_MARKET_ID, LENDING_MARKET_TYPE, graphqlClient, fetchVaultBasic, fetchVaultJson, fetchEventsGQL } from './graphql';
import type { GQLEventNode } from './graphql';

const VENUE_ID = process.env.VENUE_ID ?? '';
const PACKAGE_ID = process.env.PACKAGE_ID ?? '';
const COIN_TYPE = process.env.COIN_TYPE ?? '';

async function fetchSavingsValue(vaultId: string): Promise<bigint> {
  if (!PACKAGE_ID || !VENUE_ID || !LENDING_MARKET_ID || !LENDING_MARKET_TYPE || !COIN_TYPE) return 0n;
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::vault::savings_balance`,
      typeArguments: [LENDING_MARKET_TYPE, COIN_TYPE],
      arguments: [
        tx.object(vaultId),
        tx.object(VENUE_ID),
        tx.object(LENDING_MARKET_ID),
      ],
    });
    const result = await graphqlClient().simulateTransaction({
      transaction: tx,
      checksEnabled: false,
      include: { commandResults: true },
    });
    const bytes = result.commandResults?.[0]?.returnValues?.[0]?.bcs;
    if (bytes) return BigInt(bcs.u64().parse(bytes));
  } catch {
    // simulate failed — no active savings position or env not configured
  }
  return 0n;
}

// ─── Suilend live APR — delegated to lib/graphql.ts (SuilendClient) ───────────

export { getLiveAprBps };

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

// Exported so /api/state can call it separately alongside fetchVaultState().
export { fetchSavingsValue };

export async function getBalances(vaultId: string): Promise<Balances> {
  const [{ liquid, currentEpoch }, savingsValue] = await Promise.all([
    fetchVaultBasic(vaultId),
    fetchSavingsValue(vaultId),
  ]);
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

  const perType = Math.ceil(limit / 4) * 2;
  const eventTypes = [
    `${PACKAGE_ID}::vault::RebalanceEvent`,
    `${PACKAGE_ID}::vault::WithdrawEvent`,
    `${PACKAGE_ID}::vault::SendEvent`,
    `${PACKAGE_ID}::vault::DepositEvent`,
  ];

  const results = await Promise.allSettled(
    eventTypes.map((eventType) => fetchEventsGQL(eventType, perType)),
  );

  const events: ActivityEvent[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const eventType = eventTypes[i];
    if (result.status !== 'fulfilled') continue;
    for (const ev of result.value as GQLEventNode[]) {
      const json = ev.contents?.json;
      if (!json) continue;
      if (vaultId && String(json.vault_id ?? '') !== vaultId) continue;
      const digest = ev.transaction?.digest ?? '';
      const timestampMs = ev.timestamp ? String(new Date(ev.timestamp).getTime()) : undefined;

      if (eventType.endsWith('::RebalanceEvent')) {
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
      } else if (eventType.endsWith('::WithdrawEvent')) {
        const amount = String(json.amount ?? '0');
        const display = `$${baseToHuman(amount)}`;
        const byAgent = Boolean(json.by_agent);
        const to = String(json.to ?? '');
        const text = byAgent
          ? `Agent moved ${display} ${COIN_SYMBOL} to payout address`
          : `Withdrew ${display} ${COIN_SYMBOL} to wallet`;
        events.push({ type: 'withdraw', text, amount, byAgent, to, timestampMs, digest });
      } else if (eventType.endsWith('::SendEvent')) {
        const amount = String(json.amount ?? '0');
        const display = `$${baseToHuman(amount)}`;
        const byAgent = Boolean(json.by_agent);
        const to = String(json.to ?? '');
        const toLabel = addressToName[to.toLowerCase()] ?? (to.length > 12 ? `${to.slice(0, 6)}…${to.slice(-4)}` : to);
        const text = byAgent
          ? `Agent sent ${display} ${COIN_SYMBOL} to ${toLabel}`
          : `Sent ${display} ${COIN_SYMBOL} to ${toLabel}`;
        events.push({ type: 'send', text, amount, byAgent, to, timestampMs, digest });
      } else if (eventType.endsWith('::DepositEvent')) {
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
  const vf = await fetchVaultJson(vaultId);
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
