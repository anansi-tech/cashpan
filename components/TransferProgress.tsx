'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { AddToCashPanProposal } from '@/lib/brain';
import { executeDepositTransaction } from '@/lib/execute-zklogin';
import type { VaultTxContext } from '@/lib/vault-tx';
import { formatMoneyHuman } from '@/lib/format';

/**
 * Unified Coinbase-handoff narration: ONE stepper card in the proposal slot.
 * The step row is constant; only step states advance — the card never
 * unmounts/remounts between stages (keyed per session by the caller).
 *
 * Shared primitives (StepCard, StepList) are used by both CashOutCard
 * (cashing out, 5 steps) and OnrampProgress here (adding money, 3 steps).
 */

export type StepState = 'done' | 'active' | 'pending';
export interface Step { label: string; state: StepState }

export function StepCard({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '0.75rem',
      padding: '0.875rem 1rem', marginBottom: '0.875rem',
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.15)',
      borderLeft: `3px solid ${accent}`, borderRadius: '0.75rem',
    }}>
      {children}
    </div>
  );
}

/** Constant row of steps; only the state icons/emphasis change as it advances. */
export function StepList({ steps }: { steps: Step[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      {steps.map((s, i) => {
        const icon = s.state === 'done' ? '✓' : s.state === 'active' ? '●' : '○';
        const color = s.state === 'done' ? 'var(--color-savings)'
          : s.state === 'active' ? 'var(--color-savings-bright)' : 'var(--color-muted-2)';
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{
              width: '1rem', textAlign: 'center', color, fontSize: '0.78rem',
              animation: s.state === 'active' ? 'skeleton-pulse 1.4s ease-in-out infinite' : undefined,
            }}>{icon}</span>
            <span style={{
              fontSize: '0.8rem',
              color: s.state === 'pending' ? 'var(--color-muted-2)' : 'var(--color-text)',
              fontWeight: s.state === 'active' ? 600 : 400,
            }}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export const stepGhostBtn: CSSProperties = {
  background: 'transparent', border: '1px solid rgba(148,163,184,0.2)',
  color: 'var(--color-muted)', padding: '0.4rem 0.7rem',
  borderRadius: '0.4rem', fontSize: '0.78rem', cursor: 'pointer', flexShrink: 0,
};

export const stepPrimaryBtn: CSSProperties = {
  background: 'var(--color-savings)', border: 'none', color: '#0a0f1e',
  padding: '0.4rem 0.9rem', borderRadius: '0.4rem',
  fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
};

// ── Adding money (onramp handoff) — 3 steps ───────────────────────────────────

/**
 * ① Pay at Coinbase ✓ → ② Money on the way… → ③ Arrived — Add to CashPan.
 * `arrival` undefined = still on the way (step ②); present = arrived (step ③).
 */
export function OnrampProgress({
  arrival,
  vaultCtx,
  onDone,
  onDismiss,
}: {
  arrival: AddToCashPanProposal | undefined;
  vaultCtx: VaultTxContext;
  onDone: () => void;
  onDismiss: () => void;
}) {
  const [state, setState] = useState<'idle' | 'adding' | 'error'>('idle');
  const [error, setError] = useState('');
  const arrivedStep = !!arrival;

  const steps: Step[] = [
    { label: 'Paid at Coinbase', state: 'done' },
    { label: 'Money on the way', state: arrivedStep ? 'done' : 'active' },
    { label: 'Add to CashPan', state: arrivedStep ? 'active' : 'pending' },
  ];

  const add = async () => {
    if (!arrival) return;
    setState('adding');
    setError('');
    try {
      await executeDepositTransaction(BigInt(arrival.balanceBase), vaultCtx);
      onDone();
    } catch (e) {
      const m = e instanceof Error ? e.message.toLowerCase() : '';
      setError(m.includes('session') || m.includes('authenticated') ? 'Session expired — sign in again.'
        : m.includes('sponsor') || m.includes('gas') ? "Couldn't sponsor the transaction. Try again."
        : 'Transaction failed. Try again.');
      setState('error');
    }
  };

  return (
    <StepCard accent="var(--color-savings)">
      <StepList steps={steps} />
      {arrivedStep ? (
        <>
          <div style={{ fontSize: '0.82rem', color: 'var(--color-text)', fontWeight: 600 }}>
            ${formatMoneyHuman(arrival!.totalAmountSui)} arrived — your turn
          </div>
          {error && <div style={{ fontSize: '0.75rem', color: 'rgba(252,165,165,0.9)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button onClick={onDismiss} disabled={state === 'adding'} style={stepGhostBtn}>Not now</button>
            <button onClick={add} disabled={state === 'adding'} style={{ ...stepPrimaryBtn, opacity: state === 'adding' ? 0.6 : 1 }}>
              {state === 'adding' ? 'Adding…' : 'Add to CashPan'}
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>
            Card payments take a few minutes. We&apos;ll add it for you to confirm the moment it lands.
          </span>
          <button
            onClick={onDismiss}
            title="Your money stays in your wallet and you can add it back anytime"
            style={stepGhostBtn}
          >
            Dismiss
          </button>
        </div>
      )}
    </StepCard>
  );
}
