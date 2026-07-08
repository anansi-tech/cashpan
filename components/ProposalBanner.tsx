'use client';

import { useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import type { BrainProposal } from '@/lib/brain';
import { buildSweepFromBrain, buildTopupFromBrain, type VaultTxContext } from '@/lib/vault-tx';
import { executeTransaction, executeDepositTransaction } from '@/lib/execute-zklogin';
import { useVaultData } from './VaultDataProvider';

const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'USD';

function fmt(s: string): string {
  const n = parseFloat(s);
  return isNaN(n) ? s : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function proposalKey(p: BrainProposal): string {
  if (p.type === 'add-to-cashpan') return `add-${p.totalAmountSui}`;
  if (p.type === 'topup-from-save') return `topup-${p.amountSui}`;
  return `sweep-${p.amountSui}`;
}

export function ProposalBanner({ vaultCtx }: { vaultCtx: VaultTxContext }) {
  const { proposals, refresh } = useVaultData();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const dismiss = useCallback((key: string) => {
    setDismissed((prev) => new Set([...prev, key]));
  }, []);

  // add-to-cashpan is handled by WalletArrivalStrip; only show rebalance proposals here
  const visible = proposals.filter((p) => !dismissed.has(proposalKey(p)) && p.type !== 'add-to-cashpan');
  if (visible.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.875rem' }}>
      {visible.map((p) => (
        <BrainCard
          key={proposalKey(p)}
          proposal={p}
          vaultCtx={vaultCtx}
          onDismiss={() => dismiss(proposalKey(p))}
          onSuccess={() => {
            dismiss(proposalKey(p));
            refresh();
          }}
        />
      ))}
    </div>
  );
}

type CardState = 'idle' | 'pending' | 'success' | 'error';

function BrainCard({
  proposal,
  vaultCtx,
  onDismiss,
  onSuccess,
}: {
  proposal: BrainProposal;
  vaultCtx: VaultTxContext;
  onDismiss: () => void;
  onSuccess: () => void;
}) {
  const [state, setState] = useState<CardState>('idle');
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    setState('pending');
    setError('');
    try {
      if (proposal.type === 'add-to-cashpan') {
        await executeDepositTransaction(BigInt(proposal.balanceBase), vaultCtx);
      } else {
        const tx = proposal.type === 'topup-from-save'
          ? buildTopupFromBrain(proposal, vaultCtx)
          : buildSweepFromBrain(proposal, vaultCtx);
        await executeTransaction(tx);
      }
      setState('success');

      // Update cost-basis immediately rather than waiting for the 5-min cron.
      if (proposal.type === 'sweep-to-save' || proposal.type === 'topup-from-save') {
        fetch('/api/principal-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            direction: proposal.type === 'sweep-to-save' ? 'sweep' : 'topup',
            amountSui: proposal.amountSui,
            savingsSui: proposal.savingsBalance,
          }),
        }).catch(() => {});
      }

      setTimeout(onSuccess, 1200);
    } catch (e) {
      setState('error');
      const msg = e instanceof Error ? e.message.toLowerCase() : '';
      setError(
        msg.includes('not authenticated') || msg.includes('session')
          ? 'Session expired — please sign in again.'
          : msg.includes('sponsor') || msg.includes('shinami') || msg.includes('gas')
            ? "Couldn't sponsor the transaction. Try again."
            : msg.includes('network') || msg.includes('fetch')
              ? 'Network issue. Try again.'
              : 'Transaction failed. Try again.',
      );
    }
  };

  if (state === 'success') {
    return (
      <div style={{ ...cardStyle, borderLeftColor: 'var(--color-savings)' }}>
        <span style={{ fontSize: '0.875rem', color: 'var(--color-savings)', fontWeight: 600 }}>✓ Done</span>
      </div>
    );
  }

  let heading: string;
  let subtext: string;
  let confirmLabel: string;

  switch (proposal.type) {
    case 'add-to-cashpan':
      heading = `$${fmt(proposal.totalAmountSui)} ${COIN_SYM} in your wallet`;
      subtext = 'Add it to your CashPan?';
      confirmLabel = 'Add to CashPan';
      break;
    case 'topup-from-save':
      heading = `Spend is low ($${fmt(proposal.spendBalance)} ${COIN_SYM})`;
      subtext = `Move $${fmt(proposal.amountSui)} ${COIN_SYM} from Save?`;
      confirmLabel = 'Move to Spend';
      break;
    default:
      heading = `Spend has $${fmt(proposal.spendBalance)} ${COIN_SYM} — more than you need`;
      subtext = `Put $${fmt(proposal.amountSui)} ${COIN_SYM} in Save?`;
      confirmLabel = 'Move to Save';
  }

  return (
    <div style={cardStyle}>
      <div>
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.15rem' }}>
          {heading}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>{subtext}</div>
        {state === 'error' && (
          <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '0.3rem' }}>{error}</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button onClick={onDismiss} disabled={state === 'pending'} style={notNowBtn}>
          Not now
        </button>
        <button
          onClick={handleConfirm}
          disabled={state === 'pending'}
          style={{
            ...confirmBtn,
            opacity: state === 'pending' ? 0.6 : 1,
            cursor: state === 'pending' ? 'wait' : 'pointer',
          }}
        >
          {state === 'pending'
            ? proposal.type === 'add-to-cashpan' ? 'Adding…' : 'Moving…'
            : confirmLabel}
        </button>
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: '0.625rem',
  padding: '0.75rem 1rem',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(148,163,184,0.15)',
  borderLeft: '3px solid var(--color-savings)',
  borderRadius: '0.75rem',
};

const notNowBtn: CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(148,163,184,0.2)',
  color: 'var(--color-muted)',
  padding: '0.35rem 0.65rem',
  borderRadius: '0.4rem',
  fontSize: '0.78rem',
  cursor: 'pointer',
};

const confirmBtn: CSSProperties = {
  background: 'var(--color-savings)',
  border: 'none',
  color: '#0a0f1e',
  padding: '0.35rem 0.75rem',
  borderRadius: '0.4rem',
  fontSize: '0.78rem',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
