/**
 * Brain: proactive proposal computation.
 *
 * Pure layer: computeProposals takes already-fetched data and returns proposals.
 * Async layer: computeReadTimeProposals fetches data and delegates to the pure layer.
 *
 * INVARIANT: reads only — no keys, no signing, no Transaction objects here.
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { humanToBase, baseToHuman } from './coin-config';
import { getBalances } from './read-layer';
import type { Balances } from './read-layer';

const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet') as 'testnet';

function makeClient(): SuiJsonRpcClient {
  return new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(NETWORK), network: NETWORK });
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

export type BrainProposal = AddToCashPanProposal | SweepToSaveProposal;

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

  // 2. Sweep-to-Save: Spend > buffer + band (mirrors decide() without perTxCap,
  //    since owner_rebalance is uncapped for the owner)
  const buffer = humanToBase(settings.buffer);
  const band = humanToBase(settings.band);
  if (buffer + band > 0n) {
    const liquid = BigInt(balances.liquid);
    if (liquid > buffer + band) {
      proposals.push({
        type: 'sweep-to-save',
        amountSui: baseToHuman(liquid - buffer),
        spendBalance: baseToHuman(liquid),
        savingsBalance: baseToHuman(BigInt(balances.savingsValue)),
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
  const client = makeClient();
  const [coinsResult, balances] = await Promise.all([
    client.getCoins({ owner: walletAddress, coinType, limit: 50 }),
    getBalances(vaultId),
  ]);
  const walletCoins: WalletCoin[] = coinsResult.data.map((c) => ({
    coinObjectId: c.coinObjectId,
    balance: c.balance,
  }));
  return computeProposals(walletCoins, balances, settings);
}
