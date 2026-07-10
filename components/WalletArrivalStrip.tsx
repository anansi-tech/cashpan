'use client';

import { useState } from 'react';
import { useDeposit } from '@/lib/use-deposit';
import type { VaultTxContext } from '@/lib/vault-tx';
import { formatMoney } from '@/lib/format';

const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'USD';

const fmtBase = (base: bigint): string => formatMoney(base);

export function WalletArrivalStrip({
  vaultCtx,
}: {
  vaultCtx: Pick<VaultTxContext, 'packageId' | 'coinType' | 'vaultId'>;
}) {
  const { totalOwned, depositedAmount, state, error, deposit } = useDeposit(vaultCtx);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  if (state === 'success') {
    return (
      <div
        style={{ ...stripBase, borderLeftColor: 'var(--color-savings)', background: 'rgba(16,185,129,0.06)', animation: 'arrival-out 0.35s 1.8s ease-out forwards' }}
        onAnimationEnd={() => setDismissed(true)}
      >
        <span style={{ color: 'var(--color-savings)', fontWeight: 600, fontSize: '0.875rem' }}>
          ✓ Added ${fmtBase(depositedAmount)} {COIN_SYM} to Spend
        </span>
      </div>
    );
  }

  if (totalOwned === 0n) return null;

  return (
    <div style={stripBase}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: 'var(--color-text)', fontWeight: 600, fontSize: '0.875rem' }}>
          ${fmtBase(totalOwned)} {COIN_SYM} arrived
        </span>
        <span style={{ color: 'var(--color-muted)', fontSize: '0.85rem' }}> · from external wallet</span>
        {state === 'error' && (
          <div style={{ fontSize: '0.78rem', color: 'rgba(252,165,165,0.9)', marginTop: '0.2rem' }}>{error}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, alignItems: 'center' }}>
        <button onClick={() => setDismissed(true)} disabled={state === 'depositing'} style={dismissBtn}>
          Dismiss
        </button>
        <button
          onClick={deposit}
          disabled={state === 'depositing'}
          style={{ ...addBtn, opacity: state === 'depositing' ? 0.6 : 1, cursor: state === 'depositing' ? 'wait' : 'pointer' }}
        >
          {state === 'depositing' ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

const stripBase = {
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
  padding: '0.75rem 1rem',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(148,163,184,0.15)',
  borderLeft: '3px solid var(--color-savings)',
  borderRadius: '0.75rem',
  marginBottom: '0.875rem',
} as const;

const dismissBtn = {
  background: 'transparent',
  border: '1px solid rgba(148,163,184,0.2)',
  color: 'var(--color-muted)',
  padding: '0.35rem 0.65rem',
  borderRadius: '0.4rem',
  fontSize: '0.78rem',
  cursor: 'pointer',
} as const;

const addBtn = {
  background: 'var(--color-savings)',
  border: 'none',
  color: '#0a0f1e',
  padding: '0.35rem 0.875rem',
  borderRadius: '0.4rem',
  fontSize: '0.78rem',
  fontWeight: 600,
} as const;
