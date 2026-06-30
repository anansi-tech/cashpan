'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import type { BrainProposal } from '@/lib/brain';
import { buildDepositTx, buildSweepFromBrain, type VaultTxContext } from '@/lib/vault-tx';
import { executeTransaction } from '@/lib/execute-zklogin';

const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'USD';

function fmt(s: string): string {
  const n = parseFloat(s);
  return isNaN(n) ? s : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function proposalKey(p: BrainProposal): string {
  return p.type === 'add-to-cashpan' ? `add-${p.totalAmountSui}` : `sweep-${p.amountSui}`;
}

export function ProposalBanner({ vaultCtx }: { vaultCtx: VaultTxContext }) {
  const [proposals, setProposals] = useState<BrainProposal[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const fetchProposals = useCallback(async () => {
    try {
      const res = await fetch('/api/proposals');
      if (!res.ok) return;
      const data = (await res.json()) as BrainProposal[];
      setProposals(Array.isArray(data) ? data : []);
    } catch { /* degrade silently */ }
  }, []);

  useEffect(() => {
    void fetchProposals();
    const handler = () => void fetchProposals();
    window.addEventListener('cashpan:refresh', handler);
    return () => window.removeEventListener('cashpan:refresh', handler);
  }, [fetchProposals]);

  const dismiss = useCallback((key: string) => {
    setDismissed((prev) => new Set([...prev, key]));
  }, []);

  const visible = proposals.filter((p) => !dismissed.has(proposalKey(p)));
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
            window.dispatchEvent(new Event('cashpan:refresh'));
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
      const tx =
        proposal.type === 'add-to-cashpan'
          ? buildDepositTx(proposal.coinIds, vaultCtx)
          : buildSweepFromBrain(proposal, vaultCtx);
      await executeTransaction(tx);
      setState('success');
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

  const isAdd = proposal.type === 'add-to-cashpan';
  const heading = isAdd
    ? `$${fmt(proposal.totalAmountSui)} ${COIN_SYM} in your wallet`
    : `Spend has $${fmt(proposal.spendBalance)} ${COIN_SYM} — more than you need`;
  const subtext = isAdd
    ? 'Add it to your CashPan?'
    : `Put $${fmt(proposal.amountSui)} ${COIN_SYM} in Save?`;
  const confirmLabel = isAdd ? 'Add to CashPan' : 'Move to Save';

  return (
    <div style={cardStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.15rem' }}>
          {heading}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>{subtext}</div>
        {state === 'error' && (
          <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '0.3rem' }}>{error}</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, alignItems: 'center' }}>
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
          {state === 'pending' ? '…' : confirmLabel}
        </button>
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
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
