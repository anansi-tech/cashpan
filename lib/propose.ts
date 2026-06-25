/**
 * Proposal computation layer — reads vault state and returns structured proposals.
 *
 * These functions read chain state and validate intent.
 * INVARIANT: nothing here signs or submits a transaction.
 * grep this file for signAndExecuteTransaction, Transaction → none.
 */

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';

const RPC_URL = process.env.SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443';
const VAULT_ID = process.env.VAULT_ID ?? '';
const VENUE_ID = process.env.VENUE_ID ?? '';

function makeClient(): SuiJsonRpcClient {
  return new SuiJsonRpcClient({ url: RPC_URL, network: 'testnet' });
}

function readBalance(field: unknown): bigint {
  if (field !== null && typeof field === 'object' && 'value' in (field as object)) {
    return BigInt((field as { value: string }).value);
  }
  return BigInt(String(field ?? '0'));
}

export function getPayeeMap(): Record<string, string> {
  try {
    return JSON.parse(process.env.PAYEES ?? '{}');
  } catch {
    return {};
  }
}

function suiToMist(sui: string): bigint {
  const f = parseFloat(sui);
  if (!isFinite(f) || f < 0) throw new Error(`Invalid amount: ${sui}`);
  return BigInt(Math.round(f * 1e9));
}

function mistToSui(mist: bigint): string {
  return (Number(mist) / 1e9).toFixed(6);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type BlockReason =
  | 'not_a_payee'
  | 'not_allowlisted'
  | 'over_per_tx'
  | 'over_daily'
  | 'insufficient_liquid'
  | 'no_savings';

export interface SendProposal {
  action: 'send';
  amountMist: string;
  amountSui: string;
  payeeLabel: string;
  recipient?: string;
  liquidSui: string;
  outflowPerTxCapSui: string;
  outflowDailyRemainingSui: string;
  blocked?: BlockReason;
}

export interface WithdrawToMeProposal {
  action: 'withdrawToMe';
  amountMist: string;
  amountSui: string;
  payoutAddress: string;
  liquidSui: string;
  outflowPerTxCapSui: string;
  outflowDailyRemainingSui: string;
  blocked?: BlockReason;
}

export interface SweepProposal {
  action: 'sweep';
  amountMist: string;
  amountSui: string;
  liquidSui: string;
  savingsSui: string;
  perTxCapSui: string;
  dailyRemainingSui: string;
  blocked?: BlockReason;
}

export interface TopupProposal {
  action: 'topup';
  amountMist: string;
  amountSui: string;
  savingsSui: string;
  liquidSui: string;
  perTxCapSui: string;
  dailyRemainingSui: string;
  blocked?: BlockReason;
}

export type Proposal = SendProposal | WithdrawToMeProposal | SweepProposal | TopupProposal;

// ─── Vault state ──────────────────────────────────────────────────────────────

interface VaultState {
  liquid: bigint;
  savingsValue: bigint;
  perTxCap: bigint;
  dailyCap: bigint;
  effectiveDailySpent: bigint;
  payoutAddress: string;
  outflowPerTxCap: bigint;
  outflowDailyCap: bigint;
  effectiveOutflowDailySpent: bigint;
  allowlist: Set<string>;
}

async function fetchVaultState(): Promise<VaultState> {
  const client = makeClient();
  const [vaultObj, venueObj, systemState] = await Promise.all([
    client.getObject({ id: VAULT_ID, options: { showContent: true } }),
    client.getObject({ id: VENUE_ID, options: { showContent: true } }),
    client.getLatestSuiSystemState(),
  ]);

  if (vaultObj.data?.content?.dataType !== 'moveObject') throw new Error('Vault not found');
  if (venueObj.data?.content?.dataType !== 'moveObject') throw new Error('Venue not found');

  const vf = vaultObj.data.content.fields as Record<string, unknown>;
  const venf = venueObj.data.content.fields as Record<string, string>;
  const currentEpoch = BigInt(systemState.epoch);

  const liquid = readBalance(vf.liquid);
  const perTxCap = BigInt(String(vf.per_tx_cap ?? '0'));
  const dailyCap = BigInt(String(vf.daily_cap ?? '0'));
  const dailySpent = BigInt(String(vf.daily_spent ?? '0'));
  const lastResetEpoch = BigInt(String(vf.last_reset_epoch ?? '0'));
  const payoutAddress = String(vf.payout_address ?? '');
  const outflowPerTxCap = BigInt(String(vf.outflow_per_tx_cap ?? '0'));
  const outflowDailyCap = BigInt(String(vf.outflow_daily_cap ?? '0'));
  const outflowDailySpent = BigInt(String(vf.outflow_daily_spent ?? '0'));

  // VecSet<address> serializes as {type: "...", fields: {contents: ["0x...", ...]}}
  const allowlistObj = vf.allowlist as { fields?: { contents?: string[] }; contents?: string[] } | null;
  const allowlistAddresses = allowlistObj?.fields?.contents ?? allowlistObj?.contents ?? [];

  // Epoch reset: on-chain resets daily spend when epoch advances
  const epochReset = currentEpoch > lastResetEpoch;
  const effectiveDailySpent = epochReset ? 0n : dailySpent;
  const effectiveOutflowDailySpent = epochReset ? 0n : outflowDailySpent;

  // Savings value mirrors computeCurrentValue in read-layer.ts
  const rateBps = BigInt(venf.rate_bps ?? '0');
  const periodEpochs = BigInt(venf.period_epochs ?? '1');
  const rawPos = vf.savings_position as
    | null
    | { fields: { principal: string; entry_epoch: string } }
    | { vec: Array<{ fields: { principal: string; entry_epoch: string } }> };

  let savingsValue = 0n;
  if (rawPos !== null) {
    const posFields =
      rawPos && 'vec' in rawPos
        ? (rawPos as { vec: Array<{ fields: { principal: string; entry_epoch: string } }> }).vec[0]?.fields
        : (rawPos as { fields: { principal: string; entry_epoch: string } }).fields;
    if (posFields) {
      const principal = BigInt(posFields.principal);
      const entryEpoch = BigInt(posFields.entry_epoch);
      const elapsed = currentEpoch > entryEpoch ? currentEpoch - entryEpoch : 0n;
      savingsValue = principal + (principal * rateBps * elapsed) / (10_000n * periodEpochs);
    }
  }

  return {
    liquid,
    savingsValue,
    perTxCap,
    dailyCap,
    effectiveDailySpent,
    payoutAddress,
    outflowPerTxCap,
    outflowDailyCap,
    effectiveOutflowDailySpent,
    allowlist: new Set(allowlistAddresses),
  };
}

// ─── Proposal functions ───────────────────────────────────────────────────────

export async function proposeSend(
  amountSuiStr: string,
  payeeLabel: string,
): Promise<SendProposal> {
  const [vault, payees] = await Promise.all([fetchVaultState(), Promise.resolve(getPayeeMap())]);
  const amountMist = suiToMist(amountSuiStr);
  const recipient = payees[payeeLabel.toLowerCase()];

  const base: SendProposal = {
    action: 'send',
    amountMist: amountMist.toString(),
    amountSui: mistToSui(amountMist),
    payeeLabel,
    recipient,
    liquidSui: mistToSui(vault.liquid),
    outflowPerTxCapSui: mistToSui(vault.outflowPerTxCap),
    outflowDailyRemainingSui: mistToSui(vault.outflowDailyCap - vault.effectiveOutflowDailySpent),
  };

  if (!recipient) return { ...base, recipient: undefined, blocked: 'not_a_payee' };
  if (!vault.allowlist.has(recipient)) return { ...base, blocked: 'not_allowlisted' };
  if (amountMist > vault.outflowPerTxCap) return { ...base, blocked: 'over_per_tx' };
  if (vault.effectiveOutflowDailySpent + amountMist > vault.outflowDailyCap) return { ...base, blocked: 'over_daily' };
  if (vault.liquid < amountMist) return { ...base, blocked: 'insufficient_liquid' };

  return base;
}

export async function proposeWithdrawToMe(amountSuiStr: string): Promise<WithdrawToMeProposal> {
  const vault = await fetchVaultState();
  const amountMist = suiToMist(amountSuiStr);

  const base: WithdrawToMeProposal = {
    action: 'withdrawToMe',
    amountMist: amountMist.toString(),
    amountSui: mistToSui(amountMist),
    payoutAddress: vault.payoutAddress,
    liquidSui: mistToSui(vault.liquid),
    outflowPerTxCapSui: mistToSui(vault.outflowPerTxCap),
    outflowDailyRemainingSui: mistToSui(vault.outflowDailyCap - vault.effectiveOutflowDailySpent),
  };

  if (amountMist > vault.outflowPerTxCap) return { ...base, blocked: 'over_per_tx' };
  if (vault.effectiveOutflowDailySpent + amountMist > vault.outflowDailyCap) return { ...base, blocked: 'over_daily' };
  if (vault.liquid < amountMist) return { ...base, blocked: 'insufficient_liquid' };

  return base;
}

export async function proposeSweep(amountSuiStr?: string): Promise<SweepProposal> {
  const vault = await fetchVaultState();
  let amountMist: bigint;
  if (amountSuiStr) {
    amountMist = suiToMist(amountSuiStr);
  } else {
    // Default: all liquid up to per-tx cap
    amountMist = vault.liquid < vault.perTxCap ? vault.liquid : vault.perTxCap;
  }

  const dailyRemaining = vault.dailyCap - vault.effectiveDailySpent;

  const base: SweepProposal = {
    action: 'sweep',
    amountMist: amountMist.toString(),
    amountSui: mistToSui(amountMist),
    liquidSui: mistToSui(vault.liquid),
    savingsSui: mistToSui(vault.savingsValue),
    perTxCapSui: mistToSui(vault.perTxCap),
    dailyRemainingSui: mistToSui(dailyRemaining),
  };

  if (amountMist > vault.perTxCap) return { ...base, blocked: 'over_per_tx' };
  if (vault.effectiveDailySpent + amountMist > vault.dailyCap) return { ...base, blocked: 'over_daily' };
  if (vault.liquid < amountMist) return { ...base, blocked: 'insufficient_liquid' };

  return base;
}

export async function proposeTopup(amountSuiStr: string): Promise<TopupProposal> {
  const vault = await fetchVaultState();
  const amountMist = suiToMist(amountSuiStr);
  const dailyRemaining = vault.dailyCap - vault.effectiveDailySpent;

  const base: TopupProposal = {
    action: 'topup',
    amountMist: amountMist.toString(),
    amountSui: mistToSui(amountMist),
    savingsSui: mistToSui(vault.savingsValue),
    liquidSui: mistToSui(vault.liquid),
    perTxCapSui: mistToSui(vault.perTxCap),
    dailyRemainingSui: mistToSui(dailyRemaining),
  };

  if (amountMist > vault.perTxCap) return { ...base, blocked: 'over_per_tx' };
  if (vault.effectiveDailySpent + amountMist > vault.dailyCap) return { ...base, blocked: 'over_daily' };
  if (vault.savingsValue < amountMist) return { ...base, blocked: 'no_savings' };

  return base;
}
