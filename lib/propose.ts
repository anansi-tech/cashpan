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

import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { humanToBase, baseToHuman } from './coin-config';
import { suiClient } from './sui';

const VENUE_ID = process.env.VENUE_ID ?? '';
const PACKAGE_ID = process.env.PACKAGE_ID ?? '';
const LENDING_MARKET_ID = process.env.LENDING_MARKET_ID ?? '';
const P_TYPE = process.env.P_TYPE ?? '';
const COIN_TYPE = process.env.COIN_TYPE ?? '';

function readBalance(field: unknown): bigint {
  if (field !== null && typeof field === 'object' && 'value' in (field as object)) {
    return BigInt((field as { value: string }).value);
  }
  return BigInt(String(field ?? '0'));
}

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
  const client = suiClient();
  const vaultObj = await client.getObject({ id: vaultId, options: { showContent: true } });

  if (vaultObj.data?.content?.dataType !== 'moveObject') throw new Error('Vault not found');

  const vf = vaultObj.data.content.fields as Record<string, unknown>;
  const liquid = readBalance(vf.liquid);
  const payoutAddress = String(vf.payout_address ?? '');

  let savingsValue = 0n;
  if (PACKAGE_ID && VENUE_ID && LENDING_MARKET_ID && P_TYPE && COIN_TYPE) {
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
      if (bytes) savingsValue = BigInt(bcs.u64().parse(new Uint8Array(bytes)));
    } catch {
      // devInspect failed — no active savings position or env not configured
    }
  }

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
