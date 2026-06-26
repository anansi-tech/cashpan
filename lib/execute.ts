/**
 * Execution layer — the only place that signs and submits transactions.
 *
 * Called exclusively from /api/execute.
 * NOT imported by the chat route or any LLM tool.
 *
 * Flow: re-validate from fresh on-chain reads → build PTB → sign with agent key → submit.
 */

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import type { Proposal } from './propose';
import { getPayeeMap } from './propose';

const RPC_URL = process.env.SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443';
// Shared across all vaults (single deployment):
const VENUE_ID = process.env.VENUE_ID ?? '';
const PACKAGE_ID = process.env.PACKAGE_ID ?? '';
const COIN_TYPE = process.env.COIN_TYPE ?? '0x2::sui::SUI';

export interface VaultContext {
  vaultId: string;
  agentCapId: string;
}

function makeClient(): SuiJsonRpcClient {
  return new SuiJsonRpcClient({ url: RPC_URL, network: 'testnet' });
}

function loadAgentKeypair(): Ed25519Keypair {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key) throw new Error('AGENT_PRIVATE_KEY not configured');
  return Ed25519Keypair.fromSecretKey(key);
}

function readBalance(field: unknown): bigint {
  if (field !== null && typeof field === 'object' && 'value' in (field as object)) {
    return BigInt((field as { value: string }).value);
  }
  return BigInt(String(field ?? '0'));
}

// Re-validates proposal against fresh on-chain state before signing.
async function revalidate(proposal: Proposal, vaultId: string): Promise<void> {
  const client = makeClient();
  const [vaultObj, systemState] = await Promise.all([
    client.getObject({ id: vaultId, options: { showContent: true } }),
    client.getLatestSuiSystemState(),
  ]);

  if (vaultObj.data?.content?.dataType !== 'moveObject') {
    throw new Error('Vault not found during re-validation');
  }

  const vf = vaultObj.data.content.fields as Record<string, unknown>;
  const currentEpoch = BigInt(systemState.epoch);
  const lastResetEpoch = BigInt(String(vf.last_reset_epoch ?? '0'));
  const epochReset = currentEpoch > lastResetEpoch;

  const liquid = readBalance(vf.liquid);
  const amountMist = BigInt(proposal.amountMist);

  if (proposal.action === 'send') {
    const payees = getPayeeMap();
    const recipient = payees[proposal.payeeLabel.toLowerCase()];
    if (!recipient) throw new Error(`Payee "${proposal.payeeLabel}" not found in config`);
    if (recipient !== proposal.recipient) throw new Error('Recipient mismatch');

    const allowlistObj = vf.allowlist as { fields?: { contents?: string[] }; contents?: string[] } | null;
    const allowlist = new Set(allowlistObj?.fields?.contents ?? allowlistObj?.contents ?? []);
    if (!allowlist.has(recipient)) throw new Error(`${recipient} is not on the vault allowlist`);

    const outflowPerTxCap = BigInt(String(vf.outflow_per_tx_cap ?? '0'));
    const outflowDailyCap = BigInt(String(vf.outflow_daily_cap ?? '0'));
    const outflowDailySpent = epochReset ? 0n : BigInt(String(vf.outflow_daily_spent ?? '0'));
    if (amountMist > outflowPerTxCap) throw new Error('Amount exceeds per-tx outflow cap');
    if (outflowDailySpent + amountMist > outflowDailyCap) throw new Error('Daily outflow cap would be exceeded');
    if (liquid < amountMist) throw new Error('Insufficient liquid balance');
  }

  if (proposal.action === 'withdrawToMe') {
    const outflowPerTxCap = BigInt(String(vf.outflow_per_tx_cap ?? '0'));
    const outflowDailyCap = BigInt(String(vf.outflow_daily_cap ?? '0'));
    const outflowDailySpent = epochReset ? 0n : BigInt(String(vf.outflow_daily_spent ?? '0'));
    if (amountMist > outflowPerTxCap) throw new Error('Amount exceeds per-tx outflow cap');
    if (outflowDailySpent + amountMist > outflowDailyCap) throw new Error('Daily outflow cap would be exceeded');
    if (liquid < amountMist) throw new Error('Insufficient liquid balance');
  }

  if (proposal.action === 'sweep') {
    const perTxCap = BigInt(String(vf.per_tx_cap ?? '0'));
    const dailyCap = BigInt(String(vf.daily_cap ?? '0'));
    const dailySpent = epochReset ? 0n : BigInt(String(vf.daily_spent ?? '0'));
    if (amountMist > perTxCap) throw new Error('Amount exceeds per-tx cap');
    if (dailySpent + amountMist > dailyCap) throw new Error('Daily cap would be exceeded');
    if (liquid < amountMist) throw new Error('Insufficient liquid balance');
  }

  if (proposal.action === 'topup') {
    const perTxCap = BigInt(String(vf.per_tx_cap ?? '0'));
    const dailyCap = BigInt(String(vf.daily_cap ?? '0'));
    const dailySpent = epochReset ? 0n : BigInt(String(vf.daily_spent ?? '0'));
    if (amountMist > perTxCap) throw new Error('Amount exceeds per-tx cap');
    if (dailySpent + amountMist > dailyCap) throw new Error('Daily cap would be exceeded');
  }
}

function buildTx(proposal: Proposal, { vaultId, agentCapId }: VaultContext): Transaction {
  const tx = new Transaction();
  const target = (fn: string) => `${PACKAGE_ID}::vault::${fn}` as `${string}::${string}::${string}`;
  const amount = Number(proposal.amountMist);

  if (proposal.action === 'send') {
    tx.moveCall({
      target: target('agent_send'),
      typeArguments: [COIN_TYPE],
      arguments: [
        tx.object(agentCapId),
        tx.object(vaultId),
        tx.pure.u64(amount),
        tx.pure.address(proposal.recipient!),
      ],
    });
    return tx;
  }

  if (proposal.action === 'withdrawToMe') {
    tx.moveCall({
      target: target('agent_withdraw_to_owner'),
      typeArguments: [COIN_TYPE],
      arguments: [
        tx.object(agentCapId),
        tx.object(vaultId),
        tx.pure.u64(amount),
      ],
    });
    return tx;
  }

  // sweep (0) or topup (1)
  tx.moveCall({
    target: target('rebalance'),
    typeArguments: [COIN_TYPE],
    arguments: [
      tx.object(agentCapId),
      tx.object(vaultId),
      tx.object(VENUE_ID),
      tx.pure.u8(proposal.action === 'sweep' ? 0 : 1),
      tx.pure.u64(amount),
    ],
  });
  return tx;
}

export async function executeProposal(
  proposal: Proposal,
  vault: VaultContext,
): Promise<{ digest: string }> {
  if (proposal.blocked) {
    throw new Error(`Cannot execute a blocked proposal: ${proposal.blocked}`);
  }

  await revalidate(proposal, vault.vaultId);

  const client = makeClient();
  const keypair = loadAgentKeypair();
  const tx = buildTx(proposal, vault);

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  });

  if (result.effects?.status.status !== 'success') {
    const err = result.effects?.status.error ?? 'Unknown error';
    // Translate common Move abort codes into plain language
    throw new Error(humanizeAbort(err));
  }

  return { digest: result.digest };
}

function humanizeAbort(raw: string): string {
  if (raw.includes('EAgentRevoked') || raw.includes(', 0)')) return 'Agent capability has been revoked. Please contact the vault owner.';
  if (raw.includes('EExceedsPerTxCap') || raw.includes(', 1)')) return 'Amount exceeds the per-transaction cap set on the vault.';
  if (raw.includes('EDailyCapExceeded') || raw.includes(', 2)')) return 'Daily rebalance cap reached. Try again next epoch.';
  if (raw.includes('EInsufficientLiquid') || raw.includes(', 3)')) return 'Spend pocket balance is too low for this move.';
  if (raw.includes('ENoSavingsPosition') || raw.includes(', 4)')) return 'No savings position exists to top up from.';
  if (raw.includes('ENotAllowlisted') || raw.includes(', 8)')) return 'Recipient is not on the vault allowlist.';
  if (raw.includes('EOutflowExceedsPerTxCap') || raw.includes(', 9)')) return 'Amount exceeds the per-transaction outflow cap.';
  if (raw.includes('EOutflowDailyCapExceeded') || raw.includes(', 10)')) return 'Daily outflow cap reached. Try again next epoch.';
  return raw;
}
