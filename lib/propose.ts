/**
 * Proposal computation layer — reads vault state and returns structured proposals.
 *
 * These functions read chain state and validate intent.
 * INVARIANT: nothing here signs or submits a transaction.
 * grep this file for signAndExecuteTransaction, Transaction → none.
 *
 * Block 4: owner verbs are unrestricted on-chain. No cap checks here — only
 * affordability (can the vault actually cover the amount?). The confirm tap is the guardrail.
 */

import { humanToBase, baseToHuman } from './coin-config';
import { fetchVaultBasic, fetchVaultJson, LENDING_MARKET_ID } from './graphql';
import { fetchSavingsValue } from './read-layer';
import { validateSchedule, scheduleSentence, nextRun, type PolicySchedule } from './policy-schedule';

const VENUE_ID = process.env.VENUE_ID ?? '';
const PACKAGE_ID = process.env.PACKAGE_ID ?? '';
const COIN_TYPE = process.env.COIN_TYPE ?? '';

/** Build a normalised label→address map from the user's saved contacts. */
export function buildContactMap(contacts: Array<{ label: string; address: string }>): Record<string, string> {
  return Object.fromEntries(contacts.map((c) => [c.label.toLowerCase(), c.address]));
}

const suiToMist = humanToBase;
const mistToSui = (base: bigint) => baseToHuman(base, 6);

// ─── Types ────────────────────────────────────────────────────────────────────

export type BlockReason =
  | 'not_a_payee'
  | 'insufficient_liquid'
  | 'no_savings'
  | 'keep_exceeds_savings';

export interface SendProposal {
  action: 'send';
  amountSui: string;
  payeeLabel: string;
  recipient?: string;
  spendBalance: string;
  blocked?: BlockReason;
}

export interface WithdrawToMeProposal {
  action: 'withdrawToMe';
  amountSui: string;
  payoutAddress: string;
  spendBalance: string;
  blocked?: BlockReason;
}

export interface SweepProposal {
  action: 'sweep';
  amountSui: string;
  spendBalance: string;
  savingsSui: string;
  blocked?: BlockReason;
}

export interface TopupProposal {
  action: 'topup';
  amountSui: string;
  savingsSui: string;
  spendBalance: string;
  /**
   * True → execute via vault::redeem_position (drains the cToken position
   * exactly, savings ends at 0). A numeric topup for "everything" would race
   * accruing interest and rounding; amountSui is then only a display snapshot.
   */
  drainAll?: boolean;
  blocked?: BlockReason;
}

export type Proposal = SendProposal | WithdrawToMeProposal | SweepProposal | TopupProposal;

/**
 * Phase B: recurring-send policy proposal. NOT part of the Proposal union —
 * it renders as a PolicyCard (activation flow), never a ConfirmCard (one tx).
 */
export interface RecurringSendProposal {
  action: 'recurringSend';
  amountSui: string;
  amountBase: string;
  payeeLabel: string;
  recipient?: string;
  schedule: PolicySchedule;
  /** "Every Friday" — amount/payee are rendered by the card from the fields. */
  scheduleText: string;
  nextRunISO?: string;
  /** Recipient not yet on the on-chain allowlist → confirm shows the extra signing step. */
  needsAllowlist?: boolean;
  /** Autopilot off → confirm shows the enable step (sends need an AgentCap). */
  needsAutopilot?: boolean;
  /** Warn-not-block: active policies together could brush the daily outflow cap. */
  capWarning?: string;
  blocked?: BlockReason | 'exceeds_per_tx_cap' | 'invalid_schedule';
  /** The real per-send limit, human units — shown when blocked on the cap. */
  perTxCapSui?: string;
  blockedDetail?: string;
}

// ─── Vault state ──────────────────────────────────────────────────────────────

interface VaultState {
  liquid: bigint;
  savingsValue: bigint;
  payoutAddress: string;
}

async function fetchVaultState(vaultId: string): Promise<VaultState> {
  const [{ liquid, payoutAddress }, savingsValue] = await Promise.all([
    fetchVaultBasic(vaultId),
    fetchSavingsValue(vaultId),
  ]);
  return { liquid, savingsValue, payoutAddress };
}

// ─── Proposal functions ───────────────────────────────────────────────────────

export async function proposeSend(
  amountSuiStr: string,
  payeeLabel: string,
  vaultId: string,
  contactMap: Record<string, string> = {},
): Promise<SendProposal> {
  const vault = await fetchVaultState(vaultId);
  const amountMist = suiToMist(amountSuiStr);
  const recipient = contactMap[payeeLabel.toLowerCase()];

  const base: SendProposal = {
    action: 'send',
    amountSui: mistToSui(amountMist),
    payeeLabel,
    recipient,
    spendBalance: mistToSui(vault.liquid),
  };

  if (!recipient) return { ...base, recipient: undefined, blocked: 'not_a_payee' };
  if (vault.liquid < amountMist) return { ...base, blocked: 'insufficient_liquid' };

  return base;
}

/** VecSet<address> in GraphQL object JSON: plain array or { contents: [...] }. */
function allowlistFromVaultJson(vf: Record<string, unknown>): string[] {
  const raw = vf.allowlist as string[] | { contents?: string[] } | undefined;
  if (Array.isArray(raw)) return raw;
  return raw?.contents ?? [];
}

/**
 * Author a scheduled-send policy (Phase B). Validates against LIVE chain
 * state; returns a proposal for the PolicyCard — nothing is stored or signed
 * here. Both authoring doors (chat tool, Send-sheet form) call this.
 *
 * @param activePolicyTotalBase sum of the vault's active policy amounts, for
 *        the warn-not-block daily-cap check (caller reads it from Mongo).
 */
export async function proposeRecurringSend(
  amountSuiStr: string,
  payeeLabel: string,
  schedule: PolicySchedule,
  vaultId: string,
  contactMap: Record<string, string> = {},
  opts: { activePolicyTotalBase?: bigint; autopilotOn?: boolean } = {},
): Promise<RecurringSendProposal> {
  const amountMist = suiToMist(amountSuiStr);
  const recipient = contactMap[payeeLabel.toLowerCase()];

  const base: RecurringSendProposal = {
    action: 'recurringSend',
    amountSui: mistToSui(amountMist),
    amountBase: amountMist.toString(),
    payeeLabel,
    recipient,
    schedule,
    scheduleText: '',
  };

  try {
    validateSchedule(schedule);
  } catch (e) {
    return { ...base, blocked: 'invalid_schedule', blockedDetail: e instanceof Error ? e.message : 'Invalid schedule' };
  }
  base.scheduleText = scheduleSentence(schedule);
  base.nextRunISO = nextRun(schedule, new Date())?.toISOString();
  if (!base.nextRunISO) {
    return { ...base, blocked: 'invalid_schedule', blockedDetail: 'That date is already in the past' };
  }

  if (!recipient) return { ...base, recipient: undefined, blocked: 'not_a_payee' };
  if (amountMist <= 0n) {
    return { ...base, blocked: 'invalid_schedule', blockedDetail: 'Amount must be more than $0' };
  }

  const vf = await fetchVaultJson(vaultId);
  const perTxCap = BigInt(String(vf.outflow_per_tx_cap ?? '0'));
  const dailyCap = BigInt(String(vf.outflow_daily_cap ?? '0'));

  // Hard block: a send above the per-tx outflow cap can never execute — tell
  // the user the REAL limit rather than letting the policy fail forever.
  if (amountMist > perTxCap) {
    return { ...base, blocked: 'exceeds_per_tx_cap', perTxCapSui: mistToSui(perTxCap) };
  }

  // Warn (not block): this policy plus existing active ones could contend for
  // the daily outflow cap; sends wait for the next epoch automatically.
  const totalBase = (opts.activePolicyTotalBase ?? 0n) + amountMist;
  if (dailyCap > 0n && totalBase > dailyCap) {
    base.capWarning = `Together with your other standing orders this can pass the $${mistToSui(dailyCap)} daily limit — a send that hits it waits for the next day.`;
  }

  const allowlisted = allowlistFromVaultJson(vf).some((a) => a.toLowerCase() === recipient.toLowerCase());
  if (!allowlisted) base.needsAllowlist = true;
  if (!opts.autopilotOn) base.needsAutopilot = true;

  return base;
}

/** amount omitted → withdraw the full liquid balance (cash-out staging Max). */
export async function proposeWithdrawToMe(amountSuiStr: string | undefined, vaultId: string): Promise<WithdrawToMeProposal> {
  const vault = await fetchVaultState(vaultId);
  const amountMist = amountSuiStr !== undefined ? suiToMist(amountSuiStr) : vault.liquid;

  const base: WithdrawToMeProposal = {
    action: 'withdrawToMe',
    amountSui: mistToSui(amountMist),
    payoutAddress: vault.payoutAddress,
    spendBalance: mistToSui(vault.liquid),
  };

  if (vault.liquid < amountMist) return { ...base, blocked: 'insufficient_liquid' };

  return base;
}

export async function proposeSweep(amountSuiStr: string | undefined, vaultId: string): Promise<SweepProposal> {
  const vault = await fetchVaultState(vaultId);
  // If no amount specified, sweep all available liquid
  const amountMist = amountSuiStr ? suiToMist(amountSuiStr) : vault.liquid;

  const base: SweepProposal = {
    action: 'sweep',
    amountSui: mistToSui(amountMist),
    spendBalance: mistToSui(vault.liquid),
    savingsSui: mistToSui(vault.savingsValue),
  };

  if (vault.liquid < amountMist) return { ...base, blocked: 'insufficient_liquid' };

  return base;
}

/**
 * Topup (Save → Spend).
 *
 * - amount omitted → "move everything": full-redeem proposal (drainAll).
 * - keepInSave set → "keep $X, move the rest": remainder computed in raw base
 *   units; a zero keep degenerates to drainAll.
 * - numeric amount → plain numeric topup, validated against live savings.
 */
export async function proposeTopup(
  amountSuiStr: string | undefined,
  vaultId: string,
  keepInSaveStr?: string,
): Promise<TopupProposal> {
  const vault = await fetchVaultState(vaultId);

  const base: TopupProposal = {
    action: 'topup',
    amountSui: mistToSui(vault.savingsValue),
    savingsSui: mistToSui(vault.savingsValue),
    spendBalance: mistToSui(vault.liquid),
  };

  if (vault.savingsValue === 0n) return { ...base, blocked: 'no_savings' };

  if (keepInSaveStr !== undefined) {
    const keepMist = suiToMist(keepInSaveStr);
    if (keepMist >= vault.savingsValue) return { ...base, blocked: 'keep_exceeds_savings' };
    if (keepMist === 0n) return { ...base, drainAll: true };
    const amountMist = vault.savingsValue - keepMist; // raw base units, no rounding
    return { ...base, amountSui: mistToSui(amountMist) };
  }

  if (amountSuiStr === undefined) return { ...base, drainAll: true };

  const amountMist = suiToMist(amountSuiStr);
  if (vault.savingsValue < amountMist) return { ...base, blocked: 'no_savings' };

  return { ...base, amountSui: mistToSui(amountMist) };
}
