/**
 * Dual-signed transaction execution for zkLogin users.
 * User signs with ephemeral key + ZK proof; Shinami pays gas.
 */

import { Transaction } from '@mysten/sui/transactions';
import { getZkLoginSignature } from '@mysten/sui/zklogin';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import {
  getSession,
  getEphemeralKeypair,
  getZkProof,
  getMaxEpoch,
  buildAddressSeed,
} from './auth';
import type { ZkLoginSignatureInputs } from '@mysten/sui/zklogin';

function getClient(): SuiJsonRpcClient {
  const network = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet';
  return new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });
}

/**
 * Build the tx with onlyTransactionKind=true, get Shinami to sponsor it,
 * then sign with the user's ephemeral key + ZK proof, and submit both signatures.
 */
export async function executeTransaction(tx: Transaction): Promise<unknown> {
  const client = getClient();
  const session = getSession();
  const ephemeralKey = getEphemeralKeypair();
  const zkProof = getZkProof();
  const maxEpoch = getMaxEpoch();

  if (!session || !ephemeralKey || !zkProof) {
    throw new Error('Not authenticated. Please sign in.');
  }

  const addressSeed = buildAddressSeed();
  tx.setSender(session.address);

  // Build with onlyTransactionKind=true so the sponsor can wrap it with gas
  const txBytes = await tx.build({ client, onlyTransactionKind: true });
  const txBase64 = btoa(String.fromCharCode(...txBytes));

  // Ask Shinami to sponsor (adds gas payment, returns full sponsored tx bytes + signature)
  const sponsorRes = await fetch('/api/sponsor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txBytes: txBase64, sender: session.address }),
  });
  if (!sponsorRes.ok) {
    const err = await sponsorRes.json() as { error?: string };
    throw new Error(err.error ?? 'Gas sponsorship failed');
  }
  const sponsored = await sponsorRes.json() as { txBytes: string; signature: string };

  // Decode the sponsored bytes and sign with ephemeral key
  const sponsoredBytes = Uint8Array.from(atob(sponsored.txBytes), (c) => c.charCodeAt(0));
  const { signature: ephemeralSig } = await ephemeralKey.signTransaction(sponsoredBytes);

  // Build the zkLogin signature (combines ZK proof + ephemeral signature)
  const inputs: ZkLoginSignatureInputs = { ...zkProof, addressSeed };
  const zkLoginSig = getZkLoginSignature({ inputs, maxEpoch, userSignature: ephemeralSig });

  return client.executeTransactionBlock({
    transactionBlock: sponsoredBytes,
    signature: [zkLoginSig, sponsored.signature],
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  });
}
