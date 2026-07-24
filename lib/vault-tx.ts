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
 * Cash-out step 2: plain wallet send to Coinbase's deposit address. Funds were
 * already staged to the wallet in step 1 (withdrawToMe), so from_address
 * validation is trivially the sender. Uses coinWithBalance — server-built
 * only (the intent cannot be V1-serialized client-side).
 */
export function buildWalletSendTx(amountBase: bigint, recipient: string, coinType: string): Transaction {
  if (amountBase === 0n) throw new Error('Nothing to send');
  const tx = new Transaction();
  const coin = tx.add(coinWithBalance({ type: coinType, balance: amountBase }));
  tx.transferObjects([coin], tx.pure.address(recipient));
  return tx;
}

// ─── Autopilot (agent capability) ─────────────────────────────────────────────
//
// VERIFIED against the deployed vault.move:
//   issue_agent_cap<T>(owner_cap, vault, ctx) -> AgentCap   — NO cap arguments.
//   revoke<T>(owner_cap, vault)                             — bumps agent_nonce.
// The rebalance caps (per_tx_cap / daily_cap) are VAULT fields fixed at
// create_vault and have no setter (only set_outflow_caps exists, for the
// outflow caps). So a user-chosen daily limit is a WORKER-side soft cap; the
// chain's caps are the hard bound.

/** Owner-signed: mint an AgentCap at the current nonce and hand it to the agent. */
export function buildIssueAgentCapTx(agentAddress: string, ctx: VaultTxContext): Transaction {
  const tx = new Transaction();
  const [cap] = tx.moveCall({
    target: `${ctx.packageId}::vault::issue_agent_cap`,
    typeArguments: [ctx.coinType],
    arguments: [tx.object(ctx.ownerCapId), tx.object(ctx.vaultId)],
  });
  tx.transferObjects([cap], tx.pure.address(agentAddress));
  return tx;
}

/** Owner-signed: bump agent_nonce — every outstanding AgentCap dies instantly. */
export function buildRevokeAgentTx(ctx: VaultTxContext): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::vault::revoke`,
    typeArguments: [ctx.coinType],
    arguments: [tx.object(ctx.ownerCapId), tx.object(ctx.vaultId)],
  });
  return tx;
}

/** Owner-signed: add a recipient to the agent-send allowlist (vault::add_payee).
 *  Sponsored + whitelisted — the PolicyCard confirm flow's step ①. */
export function buildAddPayeeTx(recipient: string, ctx: Pick<VaultTxContext, 'packageId' | 'coinType' | 'vaultId' | 'ownerCapId'>): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::vault::add_payee`,
    typeArguments: [ctx.coinType],
    arguments: [tx.object(ctx.ownerCapId), tx.object(ctx.vaultId), tx.pure.address(recipient)],
  });
  return tx;
}

/**
 * AGENT-signed scheduled send (worker only — agent pays its own gas, NEVER
 * sponsored). Chain enforces: nonce → ALLOWLIST → outflow per-tx cap →
 * outflow daily cap → liquid balance. No allowlist entry, no send.
 */
export function buildAgentSendTx(
  agentCapId: string,
  amountBase: bigint,
  recipient: string,
  ctx: Pick<VaultTxContext, 'packageId' | 'coinType' | 'vaultId'>,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::vault::agent_send`,
    typeArguments: [ctx.coinType],
    arguments: [
      tx.object(agentCapId),
      tx.object(ctx.vaultId),
      tx.pure.u64(amountBase),
      tx.pure.address(recipient),
    ],
  });
  return tx;
}

/**
 * AGENT-signed rebalance (worker only — the agent pays its own gas).
 * Chain enforces: nonce validity → venue → per-tx cap → daily cap → balance.
 */
export function buildAgentRebalanceTx(
  agentCapId: string,
  direction: 0 | 1,
  amountBase: bigint,
  ctx: VaultTxContext,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.packageId}::vault::rebalance`,
    typeArguments: [ctx.pType, ctx.coinType],
    arguments: [
      tx.object(agentCapId),
      tx.object(ctx.vaultId),
      tx.object(ctx.venueId),
      tx.object(ctx.lendingMarketId),
      tx.object('0x0000000000000000000000000000000000000000000000000000000000000006'),
      tx.pure.u8(direction),
      tx.pure.u64(amountBase),
    ],
  });
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
