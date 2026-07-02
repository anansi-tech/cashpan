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
import { fetchVaultBasic, LENDING_MARKET_ID } from './graphql';
import { fetchSavingsValue } from './read-layer';

const VENUE_ID = process.env.VENUE_ID ?? '';
const PACKAGE_ID = process.env.PACKAGE_ID ?? '';
const P_TYPE = process.env.P_TYPE ?? '';
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
  | 'no_savings';

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
  blocked?: BlockReason;
}

export type Proposal = SendProposal | WithdrawToMeProposal | SweepProposal | TopupProposal;

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

export async function proposeWithdrawToMe(amountSuiStr: string, vaultId: string): Promise<WithdrawToMeProposal> {
  const vault = await fetchVaultState(vaultId);
  const amountMist = suiToMist(amountSuiStr);

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

export async function proposeTopup(amountSuiStr: string, vaultId: string): Promise<TopupProposal> {
  const vault = await fetchVaultState(vaultId);
  const amountMist = suiToMist(amountSuiStr);

  const base: TopupProposal = {
    action: 'topup',
    amountSui: mistToSui(amountMist),
    savingsSui: mistToSui(vault.savingsValue),
    spendBalance: mistToSui(vault.liquid),
  };

  if (vault.savingsValue < amountMist) return { ...base, blocked: 'no_savings' };

  return base;
}
