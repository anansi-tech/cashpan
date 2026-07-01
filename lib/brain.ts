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
import type { Balances } from './read-layer';

const RPC_URL = process.env.SUI_RPC_URL ?? 'https://fullnode.mainnet.sui.io:443';

async function getCoinsRaw(owner: string, coinType: string): Promise<WalletCoin[]> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_getCoins', params: [owner, coinType, null, 50] }),
  });
  const json = await res.json() as { result?: { data?: Array<{ coinObjectId: string; balance: string }> } };
  return (json.result?.data ?? []).map((c) => ({ coinObjectId: c.coinObjectId, balance: c.balance }));
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletCoin {
  coinObjectId: string;
  balance: string;
}

export interface AddToCashPanProposal {
  type: 'add-to-cashpan';
  totalAmountSui: string;
  coinIds: string[];
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

export function computeProposals(
  walletCoins: WalletCoin[],
  balances: Balances,
  settings: { buffer: string; band: string },
): BrainProposal[] {
  const proposals: BrainProposal[] = [];

  // 1. Add-to-CashPan: wallet holds COIN_TYPE not yet deposited
  if (walletCoins.length > 0) {
    const totalBase = walletCoins.reduce((sum, c) => sum + BigInt(c.balance), 0n);
    if (totalBase > 0n) {
      proposals.push({
        type: 'add-to-cashpan',
        totalAmountSui: baseToHuman(totalBase),
        coinIds: walletCoins.map((c) => c.coinObjectId),
      });
    }
  }

  // 2+3. Rebalance proposals — mirrors decide() without perTxCap (owner is uncapped)
  const buffer = humanToBase(settings.buffer);
  const band = humanToBase(settings.band);
  const liquid = BigInt(balances.liquid);
  const savingsValue = BigInt(balances.savingsValue);

  if (buffer > 0n) {
    if (liquid > buffer + band) {
      proposals.push({
        type: 'sweep-to-save',
        amountSui: baseToHuman(liquid - buffer),
        spendBalance: baseToHuman(liquid),
        savingsBalance: baseToHuman(savingsValue),
      });
    } else if (liquid < buffer && savingsValue > 0n) {
      const deficit = buffer - liquid;
      const amount = deficit < savingsValue ? deficit : savingsValue;
      proposals.push({
        type: 'topup-from-save',
        amountSui: baseToHuman(amount),
        spendBalance: baseToHuman(liquid),
        savingsBalance: baseToHuman(savingsValue),
      });
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
  const [walletCoins, balances] = await Promise.all([
    getCoinsRaw(walletAddress, coinType),
    getBalances(vaultId),
  ]);
  return computeProposals(walletCoins, balances, settings);
}
