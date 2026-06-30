/**
 * Brain: read-time proactive proposal computation.
 *
 * Computes advisory proposals from current chain state on every app open.
 * INVARIANT: reads only — no keys, no signing, no Transaction objects here.
 *
 * Two proposals:
 *   add-to-cashpan — wallet holds COIN_TYPE coins not yet in the vault
 *   sweep-to-save  — vault Spend > buffer + band (mirrors decide() logic)
 *
 * This is the correctness backstop: a proposal can never be silently missed
 * because it is recomputed fresh each time the user opens the app.
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { humanToBase, baseToHuman } from './coin-config';
import { getBalances } from './read-layer';

const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet') as 'testnet';

function makeClient(): SuiJsonRpcClient {
  return new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(NETWORK), network: NETWORK });
}

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Core ─────────────────────────────────────────────────────────────────────

export async function computeReadTimeProposals(
  walletAddress: string,
  vaultId: string,
  coinType: string,
): Promise<BrainProposal[]> {
  const client = makeClient();
  const buffer = humanToBase(process.env.BUFFER ?? '0');
  const band = humanToBase(process.env.BAND ?? '0');

  const [coinsResult, balances] = await Promise.all([
    client.getCoins({ owner: walletAddress, coinType, limit: 50 }),
    getBalances(vaultId),
  ]);

  const proposals: BrainProposal[] = [];

  // 1. Add-to-CashPan: wallet holds COIN_TYPE not yet deposited
  if (coinsResult.data.length > 0) {
    const totalBase = coinsResult.data.reduce((sum, c) => sum + BigInt(c.balance), 0n);
    if (totalBase > 0n) {
      proposals.push({
        type: 'add-to-cashpan',
        totalAmountSui: baseToHuman(totalBase),
        coinIds: coinsResult.data.map((c) => c.coinObjectId),
      });
    }
  }

  // 2. Sweep-to-Save: Spend > buffer + band (mirrors decide() without perTxCap,
  //    since owner_rebalance is uncapped for the owner)
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
