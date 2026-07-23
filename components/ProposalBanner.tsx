'use client';

import { useState, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { BrainProposal, AddToCashPanProposal } from '@/lib/brain';
import { humanToBase } from '@/lib/coin-config';
import { buildSweepFromBrain, buildTopupFromBrain, type VaultTxContext } from '@/lib/vault-tx';
import { executeTransaction, executeDepositTransaction } from '@/lib/execute-zklogin';
import { useVaultData } from './VaultDataProvider';
import { formatMoneyHuman } from '@/lib/format';
import { isOnrampPending, clearOnrampPending } from '@/lib/onramp';
import { isCashOutActive, cashOutStartedAt } from '@/lib/offramp';
import { CashOutCard } from './CashOutCard';
import { OnrampProgress } from './TransferProgress';

const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'USD';

const fmt = (s: string): string => formatMoneyHuman(s);

// ─── Dismiss memory ────────────────────────────────────────────────────────────
//
// "Not now" records the proposal's TRIGGER value (liquid for sweep/topup,
// wallet balance for arrivals) per proposal type. The proposal re-surfaces
// only when the trigger has moved by ≥ the user's band — their own definition
// of a material change; no hardcoded thresholds. Module scope so the desktop
// and mobile shell instances share one memory; session-lived by design
// (a reload re-evaluates — no Mongo field).

const dismissedAt = new Map<string, bigint>();

/** The balance that triggered this proposal, in base units. */
function triggerValue(p: BrainProposal): bigint {
  if (p.type === 'add-to-cashpan') return BigInt(p.balanceBase);
  return humanToBase(p.spendBalance); // sweep + topup are both liquid-driven
}

function isDismissed(p: BrainProposal, bandHuman: string): boolean {
  const at = dismissedAt.get(p.type);
  if (at === undefined) return false;
  const diff = triggerValue(p) - at;
  const abs = diff < 0n ? -diff : diff;
  const band = humanToBase(bandHuman || '0');
  // band = 0 means the user considers ANY change material.
  return band > 0n ? abs < band : abs === 0n;
}

export function recordDismissal(p: BrainProposal): void {
  dismissedAt.set(p.type, triggerValue(p));
}

/** Manual pocket action (Move form / chat confirm) resets the conversation. */
export function clearProposalDismissals(): void {
  dismissedAt.clear();
}

/** Pocket hint chips: which pocket has a live (non-dismissed) suggestion. */
export function pendingSuggestionPockets(proposals: BrainProposal[], bandHuman: string): { spend: boolean; save: boolean } {
  const visible = proposals.filter((p) => !isDismissed(p, bandHuman));
  return {
    spend: visible.some((p) => p.type === 'sweep-to-save'),
    save: visible.some((p) => p.type === 'topup-from-save'),
  };
}

/**
 * The single announcer for everything proactive — wallet arrivals included.
 * Strictly ONE visible card at a time: computeProposals orders arrival-add
 * before sweep/topup, so "$X arrived → Add" resolves first, and the next
 * poll surfaces the follow-up sweep (if the band was crossed) on its own.
 */
export function ProposalBanner({ vaultCtx }: { vaultCtx: VaultTxContext }) {
  const { proposals, settings, refresh, autopilot, policyFailures } = useVaultData();
  const [, bump] = useState(0);

  // A manual pocket action anywhere (Move form, chat confirm) clears the memory.
  useEffect(() => {
    const onActed = () => { clearProposalDismissals(); bump((n) => n + 1); };
    window.addEventListener('cashpan:pockets-changed', onActed);
    return () => window.removeEventListener('cashpan:pockets-changed', onActed);
  }, []);

  const dismiss = useCallback((p: BrainProposal) => {
    recordDismissal(p);
    bump((n) => n + 1);
  }, []);

  // A standing-order failure outranks suggestions: money the owner PLANNED
  // didn't move. Persists until acknowledged (server-side flag, not local).
  const failure = policyFailures[0];
  if (failure) {
    return <PolicyFailureCard failure={failure} onAcked={refresh} />;
  }

  // An active cash-out owns the slot outright — one visible card, always;
  // arrival/sweep/topup proposals are structurally suppressed until the
  // session concludes (recovery is the fallback, never a race). Keyed by
  // session start so cash-out #2 gets a FRESH component, not #1's stale phase.
  if (isCashOutActive()) return <CashOutCard key={cashOutStartedAt()} vaultCtx={vaultCtx} />;

  // While autopilot drives rebalancing, the app must not ALSO propose it —
  // two voices would race. Arrival/add proposals are unaffected.
  const autopilotActive = autopilot.enabled && !autopilot.suspended;
  const visible = proposals.filter((p) => {
    if (autopilotActive && (p.type === 'sweep-to-save' || p.type === 'topup-from-save')) return false;
    return !isDismissed(p, settings.band);
  });

  // Onramp handoff owns the slot while pending: ONE stepper advancing
  // ① Paid → ② On the way → ③ Add. The arrival proposal (when it lands)
  // drives step ③; the pending flag clears only when the user acts.
  if (isOnrampPending()) {
    const arrival = visible.find((p) => p.type === 'add-to-cashpan') as AddToCashPanProposal | undefined;
    return (
      <OnrampProgress
        arrival={arrival}
        vaultCtx={vaultCtx}
        onDone={() => { clearOnrampPending(); clearProposalDismissals(); bump((n) => n + 1); refresh(); }}
        onDismiss={() => { clearOnrampPending(); bump((n) => n + 1); }}
      />
    );
  }

  const current = visible[0];
  if (!current) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.875rem' }}>
      <BrainCard
        key={`${current.type}-${triggerValue(current)}`}
        proposal={current}
        vaultCtx={vaultCtx}
        onDismiss={() => dismiss(current)}
        onSuccess={() => {
          // Acting IS a manual pocket action — reset the whole memory.
          clearProposalDismissals();
          bump((n) => n + 1);
          refresh();
        }}
      />
    </div>
  );
}

// ─── Standing-order failure notify (Phase B) ──────────────────────────────────

const FAILURE_COPY: Record<string, (label: string, amount: string) => string> = {
  insufficient_funds: (l, a) => `Couldn't send ${l}'s $${formatMoneyHuman(a)} — not enough in Spend.`,
  exceeds_per_tx_cap: (l, a) => `Couldn't send ${l}'s $${formatMoneyHuman(a)} — it's over the per-send limit.`,
  crash_recovered: (l, a) => `Couldn't complete ${l}'s $${formatMoneyHuman(a)} send. It was NOT sent.`,
};

function PolicyFailureCard({ failure, onAcked }: {
  failure: { runId: string; label: string; amountSui: string; error: string; policyStatus: string };
  onAcked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const copy = FAILURE_COPY[failure.error]?.(failure.label, failure.amountSui)
    ?? `Couldn't send ${failure.label}'s $${formatMoneyHuman(failure.amountSui)} (${failure.error}).`;

  const acknowledge = async () => {
    setBusy(true);
    try {
      await fetch('/api/policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledgeRunId: failure.runId }),
      });
      onAcked();
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '0.6rem',
      padding: '0.875rem 1rem', marginBottom: '0.875rem',
      background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.3)',
      borderLeft: '3px solid rgba(251,191,36,0.8)', borderRadius: '0.75rem',
    }}>
      <div style={{ fontSize: '0.85rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
        ⚠ {copy}
        {failure.policyStatus === 'failed' && ' The standing order is paused — resume it from your profile once it\'s fixed.'}
      </div>
      <button
        onClick={acknowledge}
        disabled={busy}
        style={{
          alignSelf: 'flex-start', background: 'transparent', cursor: 'pointer',
          border: '1px solid rgba(251,191,36,0.4)', color: 'rgba(251,191,36,0.9)',
          borderRadius: '0.5rem', padding: '0.35rem 0.8rem', fontSize: '0.78rem',
          fontWeight: 600, minHeight: '36px', opacity: busy ? 0.6 : 1,
        }}
      >
        Got it
      </button>
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
      heading = `$${fmt(proposal.totalAmountSui)} ${COIN_SYM} arrived`;
      subtext = 'Add it to CashPan?';
      confirmLabel = 'Add';
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
