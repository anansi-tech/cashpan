'use client';

import { useState, useCallback } from 'react';
import type { Proposal, BlockReason } from '@/lib/propose';
import { useVaultData } from './VaultDataProvider';
import { buildTxForProposal, type VaultTxContext } from '@/lib/vault-tx';
import { executeTransaction } from '@/lib/execute-zklogin';
import { getSession } from '@/lib/auth';
import { formatMoneyHuman } from '@/lib/format';

const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'SUI';

const fmtAmt = (v: string | number): string => formatMoneyHuman(v);

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
  const liquid = fmtAmt(proposal.spendBalance);
  const savings = 'savingsSui' in proposal ? fmtAmt(proposal.savingsSui) : null;

  switch (reason) {
    case 'not_a_payee':
      return `${label} isn't in your contacts. Add them in the Contacts tab to send to them by name.`;
    case 'insufficient_liquid':
      return `Your Spend pocket only has ${liquid} ${COIN_SYM} — not enough for this.`;
    case 'no_savings':
      return `Your Save pocket only has ${savings ?? '?'} ${COIN_SYM} — not enough to move that amount.`;
    case 'keep_exceeds_savings':
      return `Your Save pocket only has ${savings ?? '?'} ${COIN_SYM} — there's nothing left to move after keeping that much.`;
  }
}

function HeadlineSentence({ proposal }: { proposal: Proposal }) {
  const amtStyle = { fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-savings-bright)' } as const;
  const a = <span style={amtStyle}>${fmtAmt(proposal.amountSui)}</span>;
  if (proposal.action === 'sweep') return <span>Move {a} from Spend to Save?</span>;
  if (proposal.action === 'topup') {
    // drainAll redeems the full position — the exact amount includes interest
    // accrued after this snapshot, so present it as "everything (~$X)".
    if (proposal.drainAll) return <span>Move everything (~{a}) from Save to Spend?</span>;
    return <span>Move {a} from Save to Spend?</span>;
  }
  if (proposal.action === 'send') return <span>Send {a} to {proposal.payeeLabel}?</span>;
  return <span>Withdraw {a} to your wallet?</span>;
}

function OutcomeStrip({ proposal }: { proposal: Proposal }) {
  const amt = parseFloat(proposal.amountSui);
  const spend = parseFloat(proposal.spendBalance);
  const savings = 'savingsSui' in proposal ? parseFloat((proposal as { savingsSui: string }).savingsSui) : 0;

  const stripStyle = { background: 'rgba(10,15,30,0.5)', borderRadius: '0.625rem', padding: '0.625rem 0.875rem', display: 'flex', alignItems: 'center', gap: '0.625rem' } as const;
  const lbl = { fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.09em', display: 'block' } as const;

  if (proposal.action === 'send' || proposal.action === 'withdrawToMe') {
    return (
      <div style={stripStyle}>
        <div>
          <span style={lbl}>💵 Spend</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-liquid)' }}>
            ${fmtAmt(Math.max(0, spend - amt))} left
          </span>
        </div>
      </div>
    );
  }
  const isSweep = proposal.action === 'sweep';
  const srcLabel = isSweep ? '💵 Spend' : '💰 Save';
  const srcVal   = isSweep ? spend - amt : savings - amt;
  const srcColor = isSweep ? 'var(--color-liquid)' : 'var(--color-savings-bright)';
  const dstLabel = isSweep ? '💰 Save' : '💵 Spend';
  const dstVal   = isSweep ? savings + amt : spend + amt;
  const dstColor = isSweep ? 'var(--color-savings-bright)' : 'var(--color-liquid)';
  return (
    <div style={stripStyle}>
      <div style={{ flex: 1 }}>
        <span style={lbl}>{srcLabel}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 700, color: srcColor }}>
          ${fmtAmt(Math.max(0, srcVal))}
        </span>
      </div>
      <span style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>→</span>
      <div style={{ flex: 1, textAlign: 'right' }}>
        <span style={lbl}>{dstLabel}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: 700, color: dstColor }}>
          ${fmtAmt(Math.max(0, dstVal))}
        </span>
      </div>
    </div>
  );
}

function DetailsDisclosure({ proposal }: { proposal: Proposal }) {
  const [open, setOpen] = useState(false);
  const amt     = parseFloat(proposal.amountSui);
  const spend   = parseFloat(proposal.spendBalance);
  const savings = 'savingsSui' in proposal ? parseFloat((proposal as { savingsSui: string }).savingsSui) : 0;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-muted)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
        >
          Details {open ? '▲' : '▼'}
        </button>
        <span style={{ fontSize: '0.72rem', color: 'var(--color-savings-bright)' }}>fee sponsored · free</span>
      </div>

      {open && (
        <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
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
              <ProposalDetail label="Spend" value={`${fmtAmt(proposal.spendBalance)} ${COIN_SYM}`} dim />
            </>
          )}
          {proposal.action === 'withdrawToMe' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                <span style={{ color: 'var(--color-muted)' }}>To</span>
                <CopyableAddress address={proposal.payoutAddress} />
              </div>
              <ProposalDetail label="Spend" value={`${fmtAmt(proposal.spendBalance)} ${COIN_SYM}`} dim />
            </>
          )}
          {proposal.action === 'sweep' && (
            <>
              <ProposalDetail label="Spend" value={`${fmtAmt(proposal.spendBalance)} ${COIN_SYM}`} dim />
              <ProposalDetail label="Save" value={`${fmtAmt((proposal as { savingsSui: string }).savingsSui)} ${COIN_SYM}`} dim />
            </>
          )}
          {proposal.action === 'topup' && (
            <>
              <ProposalDetail label="Save" value={`${fmtAmt((proposal as { savingsSui: string }).savingsSui)} ${COIN_SYM}`} dim />
              <ProposalDetail label="Spend" value={`${fmtAmt(proposal.spendBalance)} ${COIN_SYM}`} dim />
            </>
          )}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '0.4rem', marginTop: '0.15rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>After this</div>
            {(proposal.action === 'send' || proposal.action === 'withdrawToMe') && (
              <EffectRow label="Spend" before={spend} after={spend - amt} />
            )}
            {proposal.action === 'sweep' && (
              <>
                <EffectRow label="Spend" before={spend} after={spend - amt} />
                <EffectRow label="Save" before={savings} after={savings + amt} />
              </>
            )}
            {proposal.action === 'topup' && (
              <>
                <EffectRow label="Save" before={savings} after={savings - amt} />
                <EffectRow label="Spend" before={spend} after={spend + amt} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EffectRow({ label, before, after }: { label: string; before: number; after: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
      <span style={{ color: 'var(--color-muted)', minWidth: '3.25rem', flexShrink: 0 }}>{label}:</span>
      <span style={{ color: 'var(--color-text)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
        {fmtAmt(before)} → {fmtAmt(Math.max(0, after))} {COIN_SYM}
      </span>
    </div>
  );
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
  const { refresh } = useVaultData();
  const [execState, setExecState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [digest, setDigest] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const isBlocked = !!proposal.blocked;
  const accentColor = isBlocked ? 'rgba(239,68,68,0.22)' : 'rgba(16,185,129,0.14)';
  const borderColor = isBlocked ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.25)';

  const amt = parseFloat(proposal.amountSui);
  const spend = parseFloat(proposal.spendBalance);
  const savings = 'savingsSui' in proposal ? parseFloat((proposal as { savingsSui: string }).savingsSui) : 0;
  const sourceBalance = proposal.action === 'topup' ? savings : spend;
  const isLargeAmount = !isBlocked && amt > sourceBalance * 0.8 && amt > 10;

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
      refresh();
      // Events take ~2s to be indexed on Sui; second refresh picks them up
      setTimeout(refresh, 2500);
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
        maxWidth: '380px',
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
        maxWidth: '380px',
      }}>
        <div style={{ color: 'var(--color-savings)', fontSize: '0.875rem', fontWeight: 700 }}>
          ✓ {successLabel(proposal)}
        </div>
        {digest && (
          <div style={{ color: 'var(--color-muted)', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
            {digest.slice(0, 12)}…{digest.slice(-8)}
          </div>
        )}
      </div>
    );
  }

  // ── Idle / Error ──────────────────────────────────────────────────────────────
  return (
    <div className="confirm-card" style={{
      background: accentColor,
      border: `1px solid ${borderColor}`,
      borderRadius: '0.875rem',
      padding: '1.125rem 1.25rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
      maxWidth: '380px',
    }}>
      {/* Blocked */}
      {isBlocked && (
        <>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(239,68,68,0.8)' }}>
            ⚠ Blocked
          </span>
          {proposal.blocked === 'not_a_payee' ? (
            <div style={{ fontSize: '0.82rem', color: 'rgba(252,165,165,0.9)', lineHeight: 1.55 }}>
              {`${proposal.action === 'send' ? `"${proposal.payeeLabel}"` : 'This recipient'} isn't in your contacts. `}
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('cashpan:send-panel-contacts-view'))}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-savings)', fontSize: '0.82rem', fontWeight: 600, textDecoration: 'underline' }}
              >
                Add them in Contacts
              </button>
              {' to send to them by name.'}
            </div>
          ) : (
            <div style={{ fontSize: '0.82rem', color: 'rgba(252,165,165,0.9)', lineHeight: 1.55 }}>
              {blockMessage(proposal, proposal.blocked!)}
            </div>
          )}
        </>
      )}

      {/* 1. Headline sentence */}
      {!isBlocked && (
        <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.5 }}>
          <HeadlineSentence proposal={proposal} />
        </div>
      )}

      {/* 2. Outcome strip */}
      {!isBlocked && <OutcomeStrip proposal={proposal} />}

      {/* Large-amount warning */}
      {isLargeAmount && execState === 'idle' && (
        <div style={{
          background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: '0.5rem', padding: '0.5rem 0.75rem',
          fontSize: '0.78rem', color: 'rgba(251,191,36,0.9)', lineHeight: 1.5,
        }}>
          ⚠ This is most of your {proposal.action === 'topup' ? 'Save' : 'Spend'} balance — double-check before confirming.
        </div>
      )}

      {/* Error */}
      {execState === 'error' && (
        <div style={{ fontSize: '0.82rem', color: 'rgba(252,165,165,0.9)', lineHeight: 1.5 }}>
          {errorMsg}
        </div>
      )}

      {/* 3. Buttons */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {!isBlocked && (
          <button
            onClick={() => {
              if (execState === 'error') { setExecState('idle'); setErrorMsg(''); }
              else handleConfirm();
            }}
            style={{
              flex: 1,
              background: 'var(--color-savings)', color: '#0a0f1e',
              border: 'none', borderRadius: '0.625rem',
              padding: '0.6875rem 0', fontSize: '0.82rem', fontWeight: 700,
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

      {/* 4. Details disclosure */}
      {!isBlocked && <DetailsDisclosure proposal={proposal} />}
    </div>
  );
}
