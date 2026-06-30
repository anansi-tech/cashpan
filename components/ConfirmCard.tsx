'use client';

import { useState, useCallback } from 'react';
import type { Proposal, BlockReason } from '@/lib/propose';
import { buildTxForProposal, type VaultTxContext } from '@/lib/vault-tx';
import { executeTransaction } from '@/lib/execute-zklogin';
import { getSession } from '@/lib/auth';

const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'SUI';

function fmtAmt(s: string): string {
  const n = parseFloat(s);
  if (isNaN(n)) return s;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pendingVerb(proposal: Proposal): string {
  if (proposal.action === 'send') return `Sending to ${proposal.payeeLabel}…`;
  if (proposal.action === 'sweep') return 'Moving to Save…';
  if (proposal.action === 'topup') return 'Moving to Spend…';
  return 'Withdrawing…';
}

function successLabel(proposal: Proposal): string {
  if (proposal.action === 'send') return `Sent ${fmtAmt(proposal.amountSui)} ${COIN_SYM} to ${proposal.payeeLabel}`;
  if (proposal.action === 'sweep') return `${fmtAmt(proposal.amountSui)} ${COIN_SYM} moved to Save`;
  if (proposal.action === 'topup') return `${fmtAmt(proposal.amountSui)} ${COIN_SYM} moved to Spend`;
  return `${fmtAmt(proposal.amountSui)} ${COIN_SYM} withdrawn to your wallet`;
}

function friendlyError(raw: string): string {
  const r = raw.toLowerCase();
  if (r.includes('not signed in') || r.includes('session') || r.includes('not authenticated')) {
    return 'Your session expired — please sign in again.';
  }
  if (r.includes('sponsor') || r.includes('shinami') || r.includes('gas')) {
    return "Couldn't sponsor the transaction. Please try again.";
  }
  if (r.includes('network') || r.includes('fetch') || r.includes('timeout') || r.includes('econnrefused')) {
    return 'Network issue. Check your connection and try again.';
  }
  if (r.includes('insufficient') || r.includes('balance')) {
    return 'Not enough balance to cover this transaction.';
  }
  if (r.includes('moveabort') || r.includes('abort')) {
    return 'The transaction was rejected on-chain. Check your balances and try again.';
  }
  return 'Something went wrong. Please try again.';
}

interface ConfirmCardProps {
  proposal: Proposal;
  onSuccess: (digest: string) => void;
  onDismiss: () => void;
  vaultCtx: VaultTxContext;
}

function blockMessage(proposal: Proposal, reason: BlockReason): string {
  const label = proposal.action === 'send' ? `"${proposal.payeeLabel}"` : null;
  const liquid = fmtAmt(proposal.liquidSui);
  const savings = 'savingsSui' in proposal ? fmtAmt(proposal.savingsSui) : null;

  switch (reason) {
    case 'not_a_payee':
      return `${label} isn't in your contacts. Add them in the Contacts tab to send to them by name.`;
    case 'insufficient_liquid':
      return `Your Spend pocket only has ${liquid} ${COIN_SYM} — not enough for this.`;
    case 'no_savings':
      return `Your Save pocket only has ${savings ?? '?'} ${COIN_SYM} — not enough to move that amount.`;
  }
}

function actionLabel(proposal: Proposal): string {
  if (proposal.action === 'send') return `Send to ${proposal.payeeLabel}`;
  if (proposal.action === 'withdrawToMe') return 'Withdraw to wallet';
  if (proposal.action === 'sweep') return 'Move to Save';
  return 'Move to Spend';
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

function CopyableAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [address]);
  const display = `${address.slice(0, 8)}…${address.slice(-6)}`;
  return (
    <button
      onClick={copy}
      title={`Copy: ${address}`}
      style={{
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        color: copied ? 'var(--color-savings)' : 'var(--color-muted-2)',
        fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600,
        transition: 'color 0.15s',
      }}
    >
      {copied ? '✓ copied' : display}
    </button>
  );
}

function Spinner() {
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: 'var(--color-savings)', opacity: 0.7,
          animation: `cashpan-pulse 1.1s ease-in-out ${i * 0.18}s infinite`,
        }} />
      ))}
    </div>
  );
}

export function ConfirmCard({ proposal, onSuccess, onDismiss, vaultCtx }: ConfirmCardProps) {
  const [execState, setExecState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [digest, setDigest] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const isBlocked = !!proposal.blocked;
  const accentColor = isBlocked ? 'rgba(239,68,68,0.22)' : 'rgba(16,185,129,0.14)';
  const borderColor = isBlocked ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.25)';

  const handleConfirm = async () => {
    setExecState('pending');
    try {
      const session = getSession();
      if (!session) throw new Error('Not signed in');
      const ctx = { ...vaultCtx, userAddress: session.address };
      const tx = buildTxForProposal(proposal, ctx);
      const result = await executeTransaction(tx) as { digest: string };
      setDigest(result.digest ?? '');
      setExecState('success');
      onSuccess(result.digest ?? '');
      window.dispatchEvent(new CustomEvent('cashpan:refresh'));
    } catch (err) {
      setErrorMsg(friendlyError(err instanceof Error ? err.message : ''));
      setExecState('error');
    }
  };

  // ── Pending ──────────────────────────────────────────────────────────────────
  if (execState === 'pending') {
    return (
      <div className="confirm-card" style={{
        background: 'rgba(16,185,129,0.08)',
        border: '1px solid rgba(16,185,129,0.2)',
        borderRadius: '0.875rem',
        padding: '1rem 1.1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        maxWidth: '340px',
      }}>
        <Spinner />
        <span style={{ fontSize: '0.875rem', color: 'var(--color-text)', fontWeight: 500 }}>
          {pendingVerb(proposal)}
        </span>
      </div>
    );
  }

  // ── Success ───────────────────────────────────────────────────────────────────
  if (execState === 'success') {
    return (
      <div className="confirm-card" style={{
        background: 'rgba(16,185,129,0.08)',
        border: '1px solid rgba(16,185,129,0.25)',
        borderRadius: '0.875rem',
        padding: '0.875rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
        maxWidth: '340px',
      }}>
        <div style={{ color: 'var(--color-savings)', fontSize: '0.875rem', fontWeight: 700 }}>
          ✓ {successLabel(proposal)}
        </div>
        <div style={{ color: 'var(--color-muted)', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
          {digest.slice(0, 12)}…{digest.slice(-8)}
        </div>
      </div>
    );
  }

  // ── Idle / Error ──────────────────────────────────────────────────────────────
  return (
    <div className="confirm-card" style={{
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
      <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: isBlocked ? 'rgba(239,68,68,0.8)' : 'var(--color-savings)' }}>
        {isBlocked ? '⚠ Blocked' : actionLabel(proposal)}
      </span>

      {/* Block reason */}
      {isBlocked && (
        <div style={{ fontSize: '0.82rem', color: 'rgba(252,165,165,0.9)', lineHeight: 1.55 }}>
          {blockMessage(proposal, proposal.blocked!)}
        </div>
      )}

      {/* Proposal details */}
      {!isBlocked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <ProposalDetail label="Amount" value={`${fmtAmt(proposal.amountSui)} ${COIN_SYM}`} />

          {proposal.action === 'send' && (
            <>
              <ProposalDetail label="To" value={proposal.payeeLabel} />
              {proposal.recipient && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--color-muted)' }}>Address</span>
                  <CopyableAddress address={proposal.recipient} />
                </div>
              )}
              <ProposalDetail label="Spend" value={`${fmtAmt(proposal.liquidSui)} ${COIN_SYM}`} dim />
            </>
          )}

          {proposal.action === 'withdrawToMe' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                <span style={{ color: 'var(--color-muted)' }}>To</span>
                <CopyableAddress address={proposal.payoutAddress} />
              </div>
              <ProposalDetail label="Spend" value={`${fmtAmt(proposal.liquidSui)} ${COIN_SYM}`} dim />
            </>
          )}

          {proposal.action === 'sweep' && (
            <>
              <ProposalDetail label="Spend" value={`${fmtAmt(proposal.liquidSui)} ${COIN_SYM}`} dim />
              <ProposalDetail label="Save" value={`${fmtAmt(proposal.savingsSui)} ${COIN_SYM}`} dim />
            </>
          )}

          {proposal.action === 'topup' && (
            <>
              <ProposalDetail label="Save" value={`${fmtAmt(proposal.savingsSui)} ${COIN_SYM}`} dim />
              <ProposalDetail label="Spend" value={`${fmtAmt(proposal.liquidSui)} ${COIN_SYM}`} dim />
            </>
          )}
        </div>
      )}

      {/* Error */}
      {execState === 'error' && (
        <div style={{ fontSize: '0.82rem', color: 'rgba(252,165,165,0.9)', lineHeight: 1.5 }}>
          {errorMsg}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {!isBlocked && (
          <button
            onClick={() => {
              if (execState === 'error') { setExecState('idle'); setErrorMsg(''); }
              else handleConfirm();
            }}
            style={{
              background: 'var(--color-savings)', color: '#0a0f1e',
              border: 'none', borderRadius: '0.5rem',
              padding: '0.5rem 1.1rem', fontSize: '0.82rem', fontWeight: 700,
              cursor: 'pointer', minHeight: '36px',
            }}
          >
            {execState === 'error' ? 'Retry' : 'Confirm'}
          </button>
        )}
        <button
          onClick={onDismiss}
          style={{
            background: 'transparent', color: 'var(--color-muted)',
            border: '1px solid var(--color-border)', borderRadius: '0.5rem',
            padding: '0.5rem 0.875rem', fontSize: '0.82rem',
            cursor: 'pointer', minHeight: '36px',
          }}
        >
          {isBlocked ? 'Dismiss' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
