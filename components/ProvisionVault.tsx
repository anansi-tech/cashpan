'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Transaction } from '@mysten/sui/transactions';
import { executeTransaction } from '@/lib/execute-zklogin';
import { getSalt, getSession } from '@/lib/auth';

interface ProvisionVaultProps {
  packageId: string;
  pType: string;
  venueId: string;
  coinType: string;
}

// Default caps — same as create-vault script
const DECIMALS = Number(process.env.NEXT_PUBLIC_COIN_DECIMALS ?? '9');
const FACTOR = 10 ** DECIMALS;
const PER_TX_CAP        = BigInt(50  * FACTOR);
const DAILY_CAP         = BigInt(200 * FACTOR);
const OUTFLOW_PER_TX    = BigInt(20  * FACTOR);
const OUTFLOW_DAILY_CAP = BigInt(100 * FACTOR);

export function ProvisionVault({ packageId, pType, venueId, coinType }: ProvisionVaultProps) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'provisioning' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function provision() {
    setStatus('provisioning');
    setError(null);
    try {
      const session = getSession();
      if (!session) throw new Error('Not signed in — please refresh and sign in again');
      const userAddress = session.address;

      const tx = new Transaction();

      // create_vault returns OwnerCap to the caller; we transfer it to the user's address
      const [ownerCap] = tx.moveCall({
        target: `${packageId}::vault::create_vault`,
        typeArguments: [pType, coinType],
        arguments: [
          tx.object(venueId),
          tx.pure.address(userAddress),
          tx.pure.u64(PER_TX_CAP),
          tx.pure.u64(DAILY_CAP),
          tx.pure.u64(OUTFLOW_PER_TX),
          tx.pure.u64(OUTFLOW_DAILY_CAP),
        ],
      });
      tx.transferObjects([ownerCap], tx.pure.address(userAddress));

      const result = await executeTransaction(tx) as {
        digest?: string;
        effects?: { status: { status: string; error?: string }; created?: Array<{ reference: { objectId: string } }> };
        objectChanges?: Array<{ type: string; objectType?: string; objectId?: string }>;
      };

      if (result.effects?.status.status !== 'success') {
        console.error('[ProvisionVault] tx failed', {
          digest: result.digest,
          status: result.effects?.status,
          error: result.effects?.status.error,
        });
        throw new Error(result.effects?.status.error ?? `Transaction failed (digest: ${result.digest ?? 'unknown'})`);
      }

      // Extract vault ID and ownerCap ID from objectChanges
      const changes = result.objectChanges ?? [];
      const vaultObj    = changes.find((c) => c.type === 'created' && c.objectType?.includes('::vault::Vault'));
      const ownerCapObj = changes.find((c) => c.type === 'created' && c.objectType?.includes('::vault::OwnerCap'));

      if (!vaultObj?.objectId || !ownerCapObj?.objectId) {
        throw new Error('Could not find Vault or OwnerCap in transaction effects');
      }

      const salt = getSalt() ?? '';
      const coinTypeEnv = process.env.NEXT_PUBLIC_COIN_TYPE ?? coinType;

      const regRes = await fetch('/api/vault/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaultId: vaultObj.objectId,
          ownerCapId: ownerCapObj.objectId,
          payoutAddress: userAddress,
          salt,
          coinType: coinTypeEnv,
        }),
      });

      if (!regRes.ok) {
        const err = await regRes.json() as { error?: string };
        throw new Error(err.error ?? 'Vault registration failed');
      }

      setStatus('done');
      // Reload so the server component picks up the new vault record
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Provisioning failed');
      setStatus('error');
    }
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg)',
        gap: '1.5rem',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <span style={{ fontSize: '2rem' }}>🍳</span>
      <p style={{ color: 'var(--color-text)', fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>
        Create your vault
      </p>
      <p style={{ color: 'var(--color-muted)', fontSize: '0.8rem', margin: 0, maxWidth: '320px', textAlign: 'center', lineHeight: 1.6 }}>
        Your vault is a smart contract only you control. Gas is sponsored — no SUI needed.
      </p>

      {status === 'idle' && (
        <button
          onClick={provision}
          style={{
            padding: '0.625rem 1.5rem',
            background: 'var(--color-savings)',
            border: 'none',
            borderRadius: '0.5rem',
            color: '#000',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
          }}
        >
          Create vault
        </button>
      )}

      {status === 'provisioning' && (
        <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem', margin: 0 }}>
          Creating vault…
        </p>
      )}

      {status === 'done' && (
        <p style={{ color: 'var(--color-savings)', fontSize: '0.875rem', margin: 0 }}>
          Vault created — loading…
        </p>
      )}

      {error && (
        <>
          <p style={{ color: '#ef4444', fontSize: '0.8rem', margin: 0 }}>{error}</p>
          <button
            onClick={provision}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '0.4rem',
              color: 'var(--color-text)',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Retry
          </button>
        </>
      )}
    </div>
  );
}
