'use client';

import { useState, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { BrainProposal } from '@/lib/brain';
import { humanToBase } from '@/lib/coin-config';
import { buildSweepFromBrain, buildTopupFromBrain, type VaultTxContext } from '@/lib/vault-tx';
import { executeTransaction, executeDepositTransaction } from '@/lib/execute-zklogin';
import { useVaultData } from './VaultDataProvider';
import { formatMoneyHuman } from '@/lib/format';
import { isOnrampPending, clearOnrampPending } from '@/lib/onramp';
import { isCashOutActive, cashOutStartedAt } from '@/lib/offramp';
import { CashOutCard } from './CashOutCard';

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

// Quiet post-onramp line. Lives in the proposal slot so the arrival proposal
// literally REPLACES it — one place, one voice.
function WaitingForCoinbase({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div style={{ ...cardStyle, flexDirection: 'row', alignItems: 'center', borderLeftColor: 'rgba(148,163,184,0.5)', marginBottom: '0.875rem' }}>
      <span style={{ flex: 1, color: 'var(--color-muted)', fontSize: '0.82rem' }}>
        ⏳ Waiting for Coinbase… card payments take a few minutes.
      </span>
      <button onClick={onDismiss} style={notNowBtn}>Dismiss</button>
    </div>
  );
}

/**
 * The single announcer for everything proactive — wallet arrivals included.
 * Strictly ONE visible card at a time: computeProposals orders arrival-add
 * before sweep/topup, so "$X arrived → Add" resolves first, and the next
 * poll surfaces the follow-up sweep (if the band was crossed) on its own.
 */
export function ProposalBanner({ vaultCtx }: { vaultCtx: VaultTxContext }) {
  const { proposals, settings, refresh } = useVaultData();
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

  // An active cash-out owns the slot outright — one visible card, always;
  // arrival/sweep/topup proposals are structurally suppressed until the
  // session concludes (recovery is the fallback, never a race). Keyed by
  // session start so cash-out #2 gets a FRESH component, not #1's stale phase.
  if (isCashOutActive()) return <CashOutCard key={cashOutStartedAt()} vaultCtx={vaultCtx} />;

  const visible = proposals.filter((p) => !isDismissed(p, settings.band));
  const current = visible[0];

  // Money arrived — the onramp wait is over.
  if (current?.type === 'add-to-cashpan' && isOnrampPending()) clearOnrampPending();

  if (!current) {
    return isOnrampPending()
      ? <WaitingForCoinbase onDismiss={() => { clearOnrampPending(); bump((n) => n + 1); }} />
      : null;
  }

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
