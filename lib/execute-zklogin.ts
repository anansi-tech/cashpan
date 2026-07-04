/**
 * Dual-signed transaction execution for zkLogin users.
 * User signs with ephemeral key + ZK proof; Shinami pays gas.
 *
 * Network split:
 *   /api/sponsor  — server builds + resolves objects via QuickNode, calls Shinami
 *   /api/submit-tx — server submits the fully-signed tx via QuickNode
 *   This file  — client only: serialize PTB, sign sponsored bytes, pass signatures
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

export async function executeTransaction(tx: Transaction): Promise<{ digest: string }> {
  const session = getSession();
  const ephemeralKey = getEphemeralKeypair();
  const zkProof = getZkProof();
  const maxEpoch = getMaxEpoch();

  if (!session || !ephemeralKey || !zkProof) {
    throw new Error('Not authenticated. Please sign in.');
  }

  const addressSeed = buildAddressSeed();
  tx.setSender(session.address);

  // Serialize PTB commands as V2 JSON (preserves $Intent commands like coinWithBalance).
  // tx.serialize() uses the V1 binary format which rejects unresolved intents.
  const txSerialized = await tx.toJSON();

  // Server builds with QuickNode client, resolves objects, calls Shinami for gas.
  const sponsorRes = await fetch('/api/sponsor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txSerialized, sender: session.address }),
  });
  if (!sponsorRes.ok) {
    const err = await sponsorRes.json() as { error?: string };
    console.error('[executeTransaction] sponsor failed:', sponsorRes.status, err);
    throw new Error(err.error ?? 'Gas sponsorship failed');
  }
  const sponsored = await sponsorRes.json() as { txBytes: string; signature: string };

  // Sign the sponsored bytes (full tx with gas) with the ephemeral key.
  const sponsoredBytes = Uint8Array.from(atob(sponsored.txBytes), (c) => c.charCodeAt(0));
  const { signature: ephemeralSig } = await ephemeralKey.signTransaction(sponsoredBytes);

  // Combine ZK proof + ephemeral sig into the zkLogin signature.
  const inputs: ZkLoginSignatureInputs = { ...zkProof, addressSeed };
  const zkLoginSig = getZkLoginSignature({ inputs, maxEpoch, userSignature: ephemeralSig });

  // Server submits both signatures via QuickNode.
  const submitRes = await fetch('/api/submit-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txBytes: sponsored.txBytes, signatures: [zkLoginSig, sponsored.signature] }),
  });
  if (!submitRes.ok) {
    const err = await submitRes.json() as { error?: string };
    console.error('[executeTransaction] submit failed:', submitRes.status, err);
    throw new Error(err.error ?? 'Transaction submission failed');
  }
  return submitRes.json() as Promise<{ digest: string }>;
}
