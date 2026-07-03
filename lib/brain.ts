/**
 * Brain: proactive proposal computation.
 *
 * Pure layer: computeProposals takes already-fetched data and returns proposals.
 * Async layer: computeReadTimeProposals fetches data and delegates to the pure layer.
 *
 * INVARIANT: reads only — no keys, no signing, no Transaction objects here.
 */

import { humanToBase, baseToHuman } from './coin-config';
import { getBalances } from './read-layer';
import { fetchWalletBalance } from './graphql';
import type { Balances } from './read-layer';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AddToCashPanProposal {
  type: 'add-to-cashpan';
  totalAmountSui: string;
  balanceBase: string;
}

export interface SweepToSaveProposal {
  type: 'sweep-to-save';
  amountSui: string;
  spendBalance: string;
  savingsBalance: string;
}

export interface TopupFromSaveProposal {
  type: 'topup-from-save';
  amountSui: string;
  spendBalance: string;
  savingsBalance: string;
}

export type BrainProposal = AddToCashPanProposal | SweepToSaveProposal | TopupFromSaveProposal;

// ─── Pure core ────────────────────────────────────────────────────────────────

// Minimum move size — no sub-cent proposals.
const MIN_MOVE = humanToBase('0.01');

export function computeProposals(
  walletBalance: string,
  balances: Balances,
  settings: { buffer: string; band: string },
): BrainProposal[] {
  const proposals: BrainProposal[] = [];

  // 1. Add-to-CashPan: wallet holds COIN_TYPE not yet deposited
  const totalBase = BigInt(walletBalance || '0');
  if (totalBase > 0n) {
    proposals.push({
      type: 'add-to-cashpan',
      totalAmountSui: baseToHuman(totalBase),
      balanceBase: walletBalance,
    });
  }

  // 2+3. Rebalance proposals — symmetric deadband both directions.
  // Sweep fires when liquid >= buffer + band (too much in Spend).
  // Topup fires when liquid <= buffer - band (too little in Spend).
  // When band >= buffer, topup never fires — correct hysteresis.
  const buffer = humanToBase(settings.buffer);
  const band = humanToBase(settings.band);
  const liquid = BigInt(balances.liquid);
  const savingsValue = BigInt(balances.savingsValue);

  if (buffer > 0n) {
    const sweepAmount = liquid > buffer ? liquid - buffer : 0n;
    if (liquid >= buffer + band && sweepAmount >= MIN_MOVE) {
      proposals.push({
        type: 'sweep-to-save',
        amountSui: baseToHuman(sweepAmount),
        spendBalance: baseToHuman(liquid),
        savingsBalance: baseToHuman(savingsValue),
      });
    } else if (band < buffer && liquid <= buffer - band && savingsValue > 0n) {
      const deficit = buffer - liquid;
      const amount = deficit < savingsValue ? deficit : savingsValue;
      if (amount >= MIN_MOVE) {
        proposals.push({
          type: 'topup-from-save',
          amountSui: baseToHuman(amount),
          spendBalance: baseToHuman(liquid),
          savingsBalance: baseToHuman(savingsValue),
        });
      }
    }
  }

  return proposals;
}

// ─── Async convenience (fetches, then delegates to pure layer) ────────────────

export async function computeReadTimeProposals(
  walletAddress: string,
  vaultId: string,
  coinType: string,
  settings: { buffer: string; band: string } = { buffer: '50', band: '5' },
): Promise<BrainProposal[]> {
  const [walletBalance, balances] = await Promise.all([
    fetchWalletBalance(walletAddress, coinType),
    getBalances(vaultId),
  ]);
  return computeProposals(walletBalance, balances, settings);
}
