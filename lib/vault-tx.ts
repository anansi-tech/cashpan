/**
 * Client-side Transaction builders for owner-verb money moves.
 *
 * Every function returns a Transaction ready to pass to executeTransaction()
 * from lib/execute-zklogin.ts. Nothing here signs or submits.
 *
 * Owner verbs are unrestricted on-chain — the confirm tap is the guardrail.
 */

import { Transaction } from '@mysten/sui/transactions';
import type { Proposal, SendProposal, WithdrawToMeProposal, SweepProposal, TopupProposal } from './propose';
import type { SweepToSaveProposal, TopupFromSaveProposal } from './brain';
import { humanToBase } from './coin-config';

// Direction constants mirror the Move constants (SWEEP=0, TOPUP=1)
const SWEEP = 0;
const TOPUP = 1;

export interface VaultTxContext {
  packageId: string;
  coinType: string;
  vaultId: string;
  ownerCapId: string;
  venueId: string;
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
    typeArguments: [ctx.coinType],
    arguments: [
      tx.object(ctx.ownerCapId),
      tx.object(ctx.vaultId),
      tx.object(ctx.venueId),
      tx.pure.u8(SWEEP),
      tx.pure.u64(humanToBase(proposal.amountSui)),
    ],
  });
  return tx;
}

export function buildTopupTx(proposal: TopupProposal, ctx: VaultTxContext): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::vault::owner_rebalance`,
    typeArguments: [ctx.coinType],
    arguments: [
      tx.object(ctx.ownerCapId),
      tx.object(ctx.vaultId),
      tx.object(ctx.venueId),
      tx.pure.u8(TOPUP),
      tx.pure.u64(humanToBase(proposal.amountSui)),
    ],
  });
  return tx;
}

// ─── Brain PTB builders ───────────────────────────────────────────────────────

export function buildDepositTx(coinIds: string[], ctx: VaultTxContext): Transaction {
  if (coinIds.length === 0) throw new Error('No coins to deposit');
  const tx = new Transaction();
  const primary = tx.object(coinIds[0]);
  if (coinIds.length > 1) {
    tx.mergeCoins(primary, coinIds.slice(1).map((id) => tx.object(id)));
  }
  tx.moveCall({
    target: `${ctx.packageId}::vault::deposit`,
    typeArguments: [ctx.coinType],
    arguments: [tx.object(ctx.vaultId), primary],
  });
  return tx;
}

export function buildTopupFromBrain(proposal: TopupFromSaveProposal, ctx: VaultTxContext): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::vault::owner_rebalance`,
    typeArguments: [ctx.coinType],
    arguments: [
      tx.object(ctx.ownerCapId),
      tx.object(ctx.vaultId),
      tx.object(ctx.venueId),
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
    typeArguments: [ctx.coinType],
    arguments: [
      tx.object(ctx.ownerCapId),
      tx.object(ctx.vaultId),
      tx.object(ctx.venueId),
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
