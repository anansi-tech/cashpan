/**
 * Client-side Transaction builders for owner-verb money moves.
 *
 * Every function returns a Transaction ready to pass to executeTransaction()
 * from lib/execute-zklogin.ts. Nothing here signs or submits.
 *
 * Owner verbs are unrestricted on-chain — the confirm tap is the guardrail.
 */

import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import type { Proposal, SendProposal, WithdrawToMeProposal, SweepProposal, TopupProposal } from './propose';
import type { SweepToSaveProposal, TopupFromSaveProposal } from './brain';
import { humanToBase } from './coin-config';

// Direction constants mirror the Move constants (SWEEP=0, TOPUP=1)
const SWEEP = 0;
const TOPUP = 1;

export interface VaultTxContext {
  packageId: string;
  coinType: string;
  pType: string;
  vaultId: string;
  ownerCapId: string;
  venueId: string;
  lendingMarketId: string;
  userAddress: string;
}

export function buildSendTx(proposal: SendProposal, ctx: VaultTxContext): Transaction {
  if (!proposal.recipient) throw new Error('No recipient address for send');
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::vault::owner_send`,
    typeArguments: [ctx.coinType],
    arguments: [
      tx.object(ctx.ownerCapId),
      tx.object(ctx.vaultId),
      tx.pure.u64(humanToBase(proposal.amountSui)),
      tx.pure.address(proposal.recipient),
    ],
  });
  return tx;
}

export function buildWithdrawTx(proposal: WithdrawToMeProposal, ctx: VaultTxContext): Transaction {
  const tx = new Transaction();
  // withdraw() returns Coin<T> — transfer it to the user's zkLogin address
  const [coin] = tx.moveCall({
    target: `${ctx.packageId}::vault::withdraw`,
    typeArguments: [ctx.coinType],
    arguments: [
      tx.object(ctx.ownerCapId),
      tx.object(ctx.vaultId),
      tx.pure.u64(humanToBase(proposal.amountSui)),
    ],
  });
  tx.transferObjects([coin], tx.pure.address(ctx.userAddress));
  return tx;
}

export function buildSweepTx(proposal: SweepProposal, ctx: VaultTxContext): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::vault::owner_rebalance`,
    typeArguments: [ctx.pType, ctx.coinType],
    arguments: [
      tx.object(ctx.ownerCapId),
      tx.object(ctx.vaultId),
      tx.object(ctx.venueId),
      tx.object(ctx.lendingMarketId),
      tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
      tx.pure.u8(SWEEP),
      tx.pure.u64(humanToBase(proposal.amountSui)),
    ],
  });
  return tx;
}

export function buildTopupTx(proposal: TopupProposal, ctx: VaultTxContext): Transaction {
  // "Move everything": redeem_position drains the cToken position exactly —
  // savings ends at 0 regardless of interest accrued since the proposal was
  // computed. A numeric amount here would race accrual and leave dust.
  if (proposal.drainAll) {
    const tx = new Transaction();
    tx.moveCall({
      target: `${ctx.packageId}::vault::redeem_position`,
      typeArguments: [ctx.pType, ctx.coinType],
      arguments: [
        tx.object(ctx.ownerCapId),
        tx.object(ctx.vaultId),
        tx.object(ctx.venueId),
        tx.object(ctx.lendingMarketId),
        tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
      ],
    });
    return tx;
  }

  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::vault::owner_rebalance`,
    typeArguments: [ctx.pType, ctx.coinType],
    arguments: [
      tx.object(ctx.ownerCapId),
      tx.object(ctx.vaultId),
      tx.object(ctx.venueId),
      tx.object(ctx.lendingMarketId),
      tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
      tx.pure.u8(TOPUP),
      tx.pure.u64(humanToBase(proposal.amountSui)),
    ],
  });
  return tx;
}

/**
 * Cash out: ONE PTB — withdraw `amountBase` from vault liquid, transfer the
 * coin to Coinbase's deposit address. Sender = the user's zkLogin address =
 * the offramp session-token address (Coinbase validates from_address).
 */
export function buildCashOutTx(amountBase: bigint, toAddress: string, ctx: VaultTxContext): Transaction {
  const tx = new Transaction();
  const [coin] = tx.moveCall({
    target: `${ctx.packageId}::vault::withdraw`,
    typeArguments: [ctx.coinType],
    arguments: [
      tx.object(ctx.ownerCapId),
      tx.object(ctx.vaultId),
      tx.pure.u64(amountBase),
    ],
  });
  tx.transferObjects([coin], tx.pure.address(toAddress));
  return tx;
}

// ─── Brain PTB builders ───────────────────────────────────────────────────────

export function buildDepositTx(balance: bigint, ctx: Pick<VaultTxContext, 'packageId' | 'coinType' | 'vaultId'>): Transaction {
  if (balance === 0n) throw new Error('Nothing to deposit');
  const tx = new Transaction();
  const coin = tx.add(coinWithBalance({ type: ctx.coinType, balance }));
  tx.moveCall({
    target: `${ctx.packageId}::vault::deposit`,
    typeArguments: [ctx.coinType],
    arguments: [tx.object(ctx.vaultId), coin],
  });
  return tx;
}

export function buildTopupFromBrain(proposal: TopupFromSaveProposal, ctx: VaultTxContext): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::vault::owner_rebalance`,
    typeArguments: [ctx.pType, ctx.coinType],
    arguments: [
      tx.object(ctx.ownerCapId),
      tx.object(ctx.vaultId),
      tx.object(ctx.venueId),
      tx.object(ctx.lendingMarketId),
      tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
      tx.pure.u8(TOPUP),
      tx.pure.u64(humanToBase(proposal.amountSui)),
    ],
  });
  return tx;
}

export function buildSweepFromBrain(proposal: SweepToSaveProposal, ctx: VaultTxContext): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::vault::owner_rebalance`,
    typeArguments: [ctx.pType, ctx.coinType],
    arguments: [
      tx.object(ctx.ownerCapId),
      tx.object(ctx.vaultId),
      tx.object(ctx.venueId),
      tx.object(ctx.lendingMarketId),
      tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
      tx.pure.u8(SWEEP),
      tx.pure.u64(humanToBase(proposal.amountSui)),
    ],
  });
  return tx;
}

export function buildTxForProposal(proposal: Proposal, ctx: VaultTxContext): Transaction {
  switch (proposal.action) {
    case 'send':        return buildSendTx(proposal, ctx);
    case 'withdrawToMe': return buildWithdrawTx(proposal, ctx);
    case 'sweep':       return buildSweepTx(proposal, ctx);
    case 'topup':       return buildTopupTx(proposal, ctx);
  }
}
