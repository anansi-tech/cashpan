/**
 * Dual-signed transaction execution for zkLogin users.
 * User signs with ephemeral key + ZK proof; Shinami pays gas.
 *
 * Network split:
 *   /api/sponsor  — server builds + resolves objects via QuickNode, calls Shinami
 *   /api/submit-tx — server submits the fully-signed tx via QuickNode
 *   This file  — client only: serialize PTB (or describe intent), sign sponsored bytes
 *
 * Two paths:
 *   executeTransaction(tx)          — sweep/topup/send/withdraw; plain object-ref PTBs,
 *                                     V1-serialized client-side, resolved server-side.
 *   executeDepositTransaction(...)  — deposit only; coinWithBalance intent can't be
 *                                     V1-serialized, so the server builds the PTB entirely.
 */

import { Transaction } from '@mysten/sui/transactions';
import { getZkLoginSignature } from '@mysten/sui/zklogin';
import {
  getSession,
  getEphemeralKeypair,
  getZkProof,
  getMaxEpoch,
  buildAddressSeed,
} from './auth';
import type { ZkLoginSignatureInputs } from '@mysten/sui/zklogin';
import type { VaultTxContext } from './vault-tx';

// ─── Private helpers ──────────────────────────────────────────────────────────

async function callSponsor(body: unknown): Promise<{ txBytes: string; signature: string }> {
  const res = await fetch('/api/sponsor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    console.error('[sponsor] failed:', res.status, err);
    throw new Error(err.error ?? 'Gas sponsorship failed');
  }
  return res.json() as Promise<{ txBytes: string; signature: string }>;
}

function dispatchSessionExpired(): never {
  window.dispatchEvent(new CustomEvent('cashpan:session-expired'));
  throw new Error('Session expired — sign in again');
}

async function signAndSubmit(sponsored: { txBytes: string; signature: string }): Promise<{ digest: string; effects?: { status?: { status?: string; error?: string } } }> {
  const ephemeralKey = getEphemeralKeypair();
  const zkProof = getZkProof();
  const maxEpoch = getMaxEpoch();
  if (!ephemeralKey || !zkProof) dispatchSessionExpired();

  const addressSeed = buildAddressSeed();
  const sponsoredBytes = Uint8Array.from(atob(sponsored.txBytes), (c) => c.charCodeAt(0));
  const { signature: ephemeralSig } = await ephemeralKey.signTransaction(sponsoredBytes);
  const inputs: ZkLoginSignatureInputs = { ...zkProof, addressSeed };
  const zkLoginSig = getZkLoginSignature({ inputs, maxEpoch: maxEpoch!, userSignature: ephemeralSig });

  const submitRes = await fetch('/api/submit-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txBytes: sponsored.txBytes, signatures: [zkLoginSig, sponsored.signature] }),
  });
  if (!submitRes.ok) {
    const err = await submitRes.json() as { error?: string };
    console.error('[submit-tx] failed:', submitRes.status, err);
    throw new Error(err.error ?? 'Transaction submission failed');
  }
  return submitRes.json() as Promise<{ digest: string; effects?: { status?: { status?: string; error?: string } } }>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Sweep, topup, send, withdraw — plain object-ref PTBs, no unresolved intents. */
export async function executeTransaction(tx: Transaction): Promise<{ digest: string; effects?: { status?: { status?: string; error?: string } } }> {
  const session = getSession();
  if (!session) dispatchSessionExpired();

  tx.setSender(session.address);
  // V1 binary serialization — safe because these tx types use only object refs + pure args.
  const txSerialized = tx.serialize();
  const sponsored = await callSponsor({ txSerialized, sender: session.address });
  return signAndSubmit(sponsored);
}

/**
 * Deposit — coinWithBalance intent cannot be V1-serialized client-side.
 * Server builds the full PTB and resolves coin selection via suix_getCoins.
 */
export async function executeDepositTransaction(
  balance: bigint,
  ctx: Pick<VaultTxContext, 'packageId' | 'coinType' | 'vaultId'>,
): Promise<{ digest: string; effects?: { status?: { status?: string; error?: string } } }> {
  const session = getSession();
  if (!session) dispatchSessionExpired();

  const sponsored = await callSponsor({
    action: 'deposit',
    amountBase: balance.toString(),
    sender: session.address,
    vaultId: ctx.vaultId,
    packageId: ctx.packageId,
    coinType: ctx.coinType,
  });
  return signAndSubmit(sponsored);
}
