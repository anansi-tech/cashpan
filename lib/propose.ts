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

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { humanToBase, baseToHuman } from './coin-config';

const RPC_URL = process.env.SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443';
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

  const liquid = readBalance(vf.liquid);
  const payoutAddress = String(vf.payout_address ?? '');

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
