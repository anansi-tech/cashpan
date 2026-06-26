'use client';

import { useState } from 'react';
import type { Proposal, BlockReason } from '@/lib/propose';

const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'SUI';

interface ConfirmCardProps {
  proposal: Proposal;
  onSuccess: (digest: string) => void;
  onDismiss: () => void;
}

function blockMessage(proposal: Proposal, reason: BlockReason): string {
  const label = proposal.action === 'send' ? `"${proposal.payeeLabel}"` : null;
  const cap =
    'outflowPerTxCapSui' in proposal
      ? proposal.outflowPerTxCapSui
      : 'perTxCapSui' in proposal
      ? proposal.perTxCapSui
      : null;
  const dailyRemaining =
    'outflowDailyRemainingSui' in proposal
      ? proposal.outflowDailyRemainingSui
      : 'dailyRemainingSui' in proposal
      ? proposal.dailyRemainingSui
      : null;
  const liquid = 'liquidSui' in proposal ? proposal.liquidSui : null;
  const savings = 'savingsSui' in proposal ? proposal.savingsSui : null;

  switch (reason) {
    case 'not_a_payee':
      return `${label} isn't in your payee list. Add them to your PAYEES config to enable sends to them.`;
    case 'not_allowlisted':
      return `${label} is in your contacts but their address isn't on the vault's allowlist. Add it with the CLI before sending.`;
    case 'over_per_tx':
      return `Amount exceeds your per-transaction cap${cap ? ` (max ${cap} ${COIN_SYM})` : ''}.`;
    case 'over_daily':
      return `Daily cap almost exhausted.${dailyRemaining ? ` Only ${dailyRemaining} ${COIN_SYM} remaining today` : ''} — try again next epoch.`;
    case 'insufficient_liquid':
      return `Spend pocket only has ${liquid ?? '?'} ${COIN_SYM} — not enough for this.`;
    case 'no_savings':
      return `Savings pocket only has ${savings ?? '?'} ${COIN_SYM} — not enough to top up that amount.`;
  }
}

function actionLabel(proposal: Proposal): string {
  if (proposal.action === 'send') return `Send to ${proposal.payeeLabel}`;
  if (proposal.action === 'withdrawToMe') return 'Withdraw to wallet';
  if (proposal.action === 'sweep') return 'Move to savings';
  return 'Move to spending';
}

function ProposalDetail({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
      <span style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span style={{ color: dim ? 'var(--color-muted-2)' : 'var(--color-text)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}

export function ConfirmCard({ proposal, onSuccess, onDismiss }: ConfirmCardProps) {
  const [execState, setExecState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [digest, setDigest] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const isBlocked = !!proposal.blocked;
  const accentColor = isBlocked ? 'rgba(239,68,68,0.22)' : 'rgba(16,185,129,0.14)';
  const borderColor = isBlocked ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.25)';

  const handleConfirm = async () => {
    setExecState('pending');
    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proposal),
      });
      const data = await res.json() as { digest?: string; error?: string };
      if (!res.ok) {
        setErrorMsg(data.error ?? 'Execution failed');
        setExecState('error');
      } else {
        setDigest(data.digest ?? '');
        setExecState('success');
        onSuccess(data.digest ?? '');
        window.dispatchEvent(new CustomEvent('cashpan:refresh'));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Network error');
      setExecState('error');
    }
  };

  if (execState === 'success') {
    return (
      <div style={{
        background: 'rgba(16,185,129,0.08)',
        border: '1px solid rgba(16,185,129,0.2)',
        borderRadius: '0.875rem',
        padding: '0.875rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
      }}>
        <div style={{ color: 'var(--color-savings)', fontSize: '0.82rem', fontWeight: 600 }}>
          ✓ Done
        </div>
        <div style={{ color: 'var(--color-muted)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
          {digest.slice(0, 12)}…{digest.slice(-8)}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: accentColor,
      border: `1px solid ${borderColor}`,
      borderRadius: '0.875rem',
      padding: '1rem 1.1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
      maxWidth: '340px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: isBlocked ? 'rgba(239,68,68,0.8)' : 'var(--color-savings)' }}>
          {isBlocked ? '⚠ Blocked' : actionLabel(proposal)}
        </span>
      </div>

      {/* Block reason */}
      {isBlocked && (
        <div style={{ fontSize: '0.82rem', color: 'rgba(252,165,165,0.9)', lineHeight: 1.55 }}>
          {blockMessage(proposal, proposal.blocked!)}
        </div>
      )}

      {/* Proposal details */}
      {!isBlocked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <ProposalDetail label="Amount" value={`${proposal.amountSui} ${COIN_SYM}`} />

          {proposal.action === 'send' && (
            <>
              <ProposalDetail label="To" value={proposal.payeeLabel} />
              {proposal.recipient && (
                <ProposalDetail
                  label="Address"
                  value={`${proposal.recipient.slice(0, 8)}…${proposal.recipient.slice(-6)}`}
                  dim
                />
              )}
              <ProposalDetail label="Daily outflow remaining" value={`${proposal.outflowDailyRemainingSui} ${COIN_SYM}`} dim />
            </>
          )}

          {proposal.action === 'withdrawToMe' && (
            <>
              <ProposalDetail
                label="To"
                value={`${proposal.payoutAddress.slice(0, 8)}…${proposal.payoutAddress.slice(-6)}`}
                dim
              />
              <ProposalDetail label="Daily outflow remaining" value={`${proposal.outflowDailyRemainingSui} ${COIN_SYM}`} dim />
            </>
          )}

          {proposal.action === 'sweep' && (
            <>
              <ProposalDetail label="From spend pocket" value={`${proposal.liquidSui} ${COIN_SYM}`} dim />
              <ProposalDetail label="Daily cap remaining" value={`${proposal.dailyRemainingSui} ${COIN_SYM}`} dim />
            </>
          )}

          {proposal.action === 'topup' && (
            <>
              <ProposalDetail label="From savings" value={`${proposal.savingsSui} ${COIN_SYM}`} dim />
              <ProposalDetail label="Daily cap remaining" value={`${proposal.dailyRemainingSui} ${COIN_SYM}`} dim />
            </>
          )}
        </div>
      )}

      {/* Error from execute */}
      {execState === 'error' && (
        <div style={{ fontSize: '0.8rem', color: 'rgba(252,165,165,0.9)', lineHeight: 1.5 }}>
          {errorMsg}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {!isBlocked && (
          <button
            onClick={() => {
              if (execState === 'error') setExecState('idle');
              else handleConfirm();
            }}
            disabled={execState === 'pending'}
            style={{
              background: execState === 'pending' ? 'rgba(16,185,129,0.3)' : 'var(--color-savings)',
              color: '#0a0f1e',
              border: 'none',
              borderRadius: '0.5rem',
              padding: '0.5rem 1.1rem',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: execState === 'pending' ? 'not-allowed' : 'pointer',
            }}
          >
            {execState === 'pending' ? 'Confirming…' : execState === 'error' ? 'Try again' : 'Confirm'}
          </button>
        )}
        <button
          onClick={onDismiss}
          style={{
            background: 'transparent',
            color: 'var(--color-muted)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.5rem',
            padding: '0.5rem 0.875rem',
            fontSize: '0.82rem',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
