'use client';

import { useState, useCallback } from 'react';
import type { Proposal, BlockReason } from '@/lib/propose';
import { buildTxForProposal, type VaultTxContext } from '@/lib/vault-tx';
import { executeTransaction } from '@/lib/execute-zklogin';
import { getSession } from '@/lib/auth';

const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'SUI';

// Trim trailing zeros past 2 decimal places: "10.000000" → "10.00", "0.050000" → "0.05"
function fmtAmt(s: string): string {
  const n = parseFloat(s);
  if (isNaN(n)) return s;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface ConfirmCardProps {
  proposal: Proposal;
  onSuccess: (digest: string) => void;
  onDismiss: () => void;
  vaultCtx: VaultTxContext;
}

function blockMessage(proposal: Proposal, reason: BlockReason): string {
  const label = proposal.action === 'send' ? `"${proposal.payeeLabel}"` : null;
  const liquid = proposal.liquidSui;
  const savings = 'savingsSui' in proposal ? proposal.savingsSui : null;

  switch (reason) {
    case 'not_a_payee':
      return `${label} isn't in your contacts. Add them in the Contacts tab to send to them by name.`;
    case 'insufficient_liquid':
      return `Your spend pocket only has ${liquid} ${COIN_SYM} — not enough for this.`;
    case 'no_savings':
      return `Your save pocket only has ${savings ?? '?'} ${COIN_SYM} — not enough to move that amount.`;
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
      title={`Copy address: ${address}`}
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
      const txDigest = result.digest ?? '';
      setDigest(txDigest);
      setExecState('success');
      onSuccess(txDigest);
      window.dispatchEvent(new CustomEvent('cashpan:refresh'));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Execution failed');
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
