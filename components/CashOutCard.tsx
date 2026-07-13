'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useVaultData } from './VaultDataProvider';
import type { VaultTxContext } from '@/lib/vault-tx';
import { executeWalletSendTransaction } from '@/lib/execute-zklogin';
import { humanToBase } from '@/lib/coin-config';
import { formatMoney, formatMoneyHuman } from '@/lib/format';
import { clearCashOut, cashOutStartedAt, setCashOutSent, getCashOutSentDigest } from '@/lib/offramp';
import { classifyOfframpPoll } from '@/lib/offramp-match';
import { StepCard, StepList, stepGhostBtn, stepPrimaryBtn, type Step } from './TransferProgress';

const NO_ORDER_GIVE_UP_MS = 5 * 60 * 1000;  // PRE-ORDER absolute cap (backstop, esp. mobile redirect)
const RETURN_GRACE_MS = 75 * 1000;          // after the user RETURNS from the widget with no order, conclude fast
// Backoff stretches to 60s — post-send polling runs until a TERMINAL status,
// however long the sell takes. Never freeze the card mid-flight.
const POLL_STEPS_MS = [3_000, 5_000, 8_000, 13_000, 21_000, 30_000, 45_000, 60_000];

interface OfframpTx {
  status: string;
  sellAmount?: string;
  currency: string;
  fiatAmount?: string;
  fiatCurrency?: string;
  paymentMethod?: string;
  asset: string;
  network: string;
  toAddress?: string;
  /** Set once Coinbase has detected the on-chain deposit. */
  txHash?: string;
  createdAt?: string;
}

type Phase =
  | 'waiting'    // widget open / no Coinbase tx yet
  | 'confirm'    // Coinbase has amount + address; user must sign the send
  | 'sending'
  | 'sent'       // send signed; waiting for Coinbase to pay out
  | 'paid'
  | 'expired'    // 30-min window closed before signing
  | 'failed'     // Coinbase reported failure (incl. price-drop cancel)
  | 'gone';      // dismissed / gave up waiting — render nothing, free the slot
                 // (staged USDC in the wallet triggers the arrival proposal)

/**
 * The cash-out flow card — renders in the proposal slot (one voice, one card).
 * Polls /api/offramp/status with backoff; every state change comes from
 * Coinbase's status API, surfaced honestly.
 */
export function CashOutCard({ vaultCtx }: { vaultCtx: VaultTxContext }) {
  const { walletBalance, refresh } = useVaultData();
  // Resume on load: a persisted sent-digest means the send already happened —
  // never re-offer the confirm (double-sign hazard); jump straight to 'sent'.
  const [phase, setPhase] = useState<Phase>(() => (getCashOutSentDigest() ? 'sent' : 'waiting'));
  const [tx, setTx] = useState<OfframpTx | null>(null);
  const [error, setError] = useState('');
  const pollIdx = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollInFlight = useRef(false);
  const returnedAt = useRef(0); // when the user came back from the widget (0 = not yet)
  const phaseRef = useRef<Phase>('waiting');
  phaseRef.current = phase;

  const startedAt = cashOutStartedAt();

  const poll = useCallback(async () => {
    if (pollInFlight.current) return;
    pollInFlight.current = true;
    try {
      const res = await fetch('/api/offramp/status', { cache: 'no-store' });
      const data = await res.json().catch(() => ({})) as { transaction?: OfframpTx | null; error?: string };
      const t = data.transaction;

      if (t) {
        const current = phaseRef.current;
        const decision = classifyOfframpPoll(
          t,
          startedAt,
          current === 'gone' || current === 'paid' || current === 'failed' || current === 'expired' ? 'waiting' : current,
          Date.now(),
        );
        // 'wait' covers historical transactions too — they can never satisfy,
        // clear, or terminate this session (prior regression: an old terminal
        // tx concluded a live session before the new order propagated).
        if (decision !== 'wait') {
          setTx(t);
          // Terminal states KEEP the active flag — the card stays visible
          // until the user dismisses it.
          if (decision === 'paid') { setPhase('paid'); refresh(); return; }
          if (decision === 'failed') { setPhase('failed'); return; }
          if (decision === 'expired') { setPhase('expired'); return; }
          if (decision === 'confirm' && current === 'waiting') setPhase('confirm');
        }
      }
    } catch { /* transient — keep polling */ }
    finally { pollInFlight.current = false; }

    // PRE-ORDER give-up: conclude quietly when no order appeared and nothing
    // was sent — the staged USDC sits at the wallet and the arrival proposal
    // recovers it. Fires on EITHER the absolute cap OR, once the user has
    // RETURNED from the widget without ordering, a short grace (so abandonment
    // recovers in ~75s, not minutes). POST-SEND polling never gives up.
    if (phaseRef.current === 'waiting' && !getCashOutSentDigest()) {
      const grace = returnedAt.current > 0 && Date.now() - returnedAt.current > RETURN_GRACE_MS;
      const capped = Date.now() - startedAt > NO_ORDER_GIVE_UP_MS;
      if (grace || capped) {
        clearCashOut();
        setPhase('gone');
        refresh();
        return;
      }
    }

    const delay = POLL_STEPS_MS[Math.min(pollIdx.current, POLL_STEPS_MS.length - 1)];
    pollIdx.current += 1;
    timerRef.current = setTimeout(() => { void poll(); }, delay);
  }, [refresh, startedAt]);

  useEffect(() => {
    void poll();
    // Mobile browsers throttle timers while Coinbase is in front. Resume with
    // a fresh poll instead of waiting for a delayed background timeout.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      // Coming back to the tab with the widget still pre-order = the user
      // returned (closed the popup / came back). Arm the short give-up grace.
      if (phaseRef.current === 'waiting' && !getCashOutSentDigest() && returnedAt.current === 0) {
        returnedAt.current = Date.now();
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      pollIdx.current = 0;
      void poll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [poll]);

  const handleSign = async () => {
    if (!tx?.toAddress || !tx.sellAmount) return;
    setPhase('sending');
    setError('');
    try {
      // Funds were staged to the wallet in step 1 — this is a plain wallet
      // send, so Coinbase's from_address check is trivially the sender.
      const result = await executeWalletSendTransaction(humanToBase(tx.sellAmount), tx.toAddress, vaultCtx.coinType);
      setCashOutSent(result.digest); // survives reloads — resume at 'sent'
      // The pre-send poll may already be at the 60s backoff. Start over now
      // that Coinbase has an on-chain transaction to detect.
      phaseRef.current = 'sent';
      setPhase('sent');
      if (timerRef.current) clearTimeout(timerRef.current);
      pollIdx.current = 0;
      void poll();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transaction failed. Try again.');
      setPhase('confirm');
    }
  };

  // Dismiss stops the polling timer dead — never poll past a dismissal.
  const dismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    clearCashOut();
    setPhase('gone');
    refresh();
  };

  if (phase === 'gone') return null;

  // ── One stepper card — advances in place, never remounts between stages ─────
  const STEP_LABELS = [
    'Place your order at Coinbase',
    'Waiting for your order',
    'Your turn — send to Coinbase',
    'Coinbase is processing',
    'On the way to your bank',
  ];
  // Which step is current for this phase.
  const activeIdx = phase === 'waiting' ? 1
    : (phase === 'confirm' || phase === 'sending') ? 2
    : phase === 'sent' ? 3
    : phase === 'paid' ? 4
    : /* expired/failed */ (getCashOutSentDigest() ? 3 : 1);

  const steps: Step[] = STEP_LABELS.map((label, i) => ({
    label,
    state: phase === 'paid' ? 'done' : i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending',
  }));

  const accent = phase === 'failed' ? 'rgba(239,68,68,0.5)'
    : phase === 'expired' ? 'rgba(245,158,11,0.6)'
    : 'var(--color-savings)';

  const amount = tx?.sellAmount ?? '0';
  const digest = getCashOutSentDigest();

  return (
    <StepCard accent={accent}>
      <StepList steps={steps} />

      {/* Failure / expiry replace the current step's detail with the terminal state. */}
      {phase === 'expired' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--color-muted)' }}>This cash-out expired — start again from Send → Cash out.</span>
          <button onClick={dismiss} style={stepGhostBtn}>Dismiss</button>
        </div>
      )}
      {phase === 'failed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--color-muted)' }}>
              Coinbase couldn&apos;t complete the sale — your {tx?.asset ?? 'USDC'} is in your Coinbase account.
            </span>
            <button onClick={dismiss} style={stepGhostBtn}>Dismiss</button>
          </div>
          {tx?.status && <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}>Coinbase status: {tx.status}</span>}
        </div>
      )}

      {/* ② Waiting — the only step where Dismiss is offered (consequence stated). */}
      {phase === 'waiting' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>
            Pick your amount and confirm in Coinbase — we&apos;ll bring it back here to finish.
          </span>
          <button
            onClick={dismiss}
            title="Your money will return to your wallet and you can add it back"
            style={stepGhostBtn}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ③ Your turn — send $X (no Dismiss here). */}
      {(phase === 'confirm' || phase === 'sending') && (() => {
        const insufficient = BigInt(walletBalance || '0') < humanToBase(amount);
        return (
          <>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text)' }}>
              Send ${formatMoneyHuman(amount)} {tx?.asset ?? 'USDC'} to Coinbase
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>Complete within 30 minutes or the cash-out expires.</div>
            {insufficient && (
              <div style={{ fontSize: '0.78rem', color: 'rgba(252,165,165,0.9)' }}>
                Your wallet only has ${formatMoney(walletBalance || '0')} staged — the order can&apos;t be covered.
              </div>
            )}
            <div style={{ fontSize: '0.72rem', color: 'var(--color-muted)', lineHeight: 1.5 }}>
              Your payout goes to the account you pick in Coinbase — bank, or your Coinbase USD balance.
              Bank not listed? Verify it at coinbase.com → Payment methods.
            </div>
            {error && <div style={{ fontSize: '0.78rem', color: 'rgba(252,165,165,0.9)' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={handleSign} disabled={phase === 'sending' || insufficient} style={{ ...stepPrimaryBtn, opacity: phase === 'sending' || insufficient ? 0.6 : 1 }}>
                {phase === 'sending' ? 'Sending…' : 'Confirm & send'}
              </button>
            </div>
          </>
        );
      })()}

      {/* ④ Sent — Coinbase processing. */}
      {phase === 'sent' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--color-text)', fontWeight: 600 }}>
            {tx?.txHash ? 'Coinbase received your USDC — selling…' : 'Sent on-chain — waiting for Coinbase to receive it…'}
          </div>
          {digest && (
            <a href={`https://suivision.xyz/txblock/${digest}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}>
              {digest.slice(0, 12)}…{digest.slice(-8)} ↗
            </a>
          )}
          <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>Coinbase will also text or email you updates.</span>
        </div>
      )}

      {/* ⑤ Paid — terminal. */}
      {phase === 'paid' && (() => {
        const fiat = formatMoneyHuman(tx?.fiatAmount ?? tx?.sellAmount ?? '0');
        const currency = tx?.fiatCurrency ?? 'USD';
        const money = currency === 'USD' ? `$${fiat}` : `${currency} ${fiat}`;
        const method = tx?.paymentMethod?.toUpperCase();
        const title = method === 'ACH_BANK_ACCOUNT' ? `${money} is on the way to your bank.`
          : method === 'FIAT_WALLET' ? `${money} is now in your Coinbase ${currency} balance.`
          : method === 'PAYPAL' ? `${money} is on the way to your PayPal account.`
          : `Your ${money} cash-out is complete.`;
        const detail = method === 'ACH_BANK_ACCOUNT'
          ? 'Bank transfers (ACH) take 1–3 business days. Coinbase will also text or email you updates.'
          : 'Coinbase will also text or email you updates.';
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--color-savings)', fontWeight: 600 }}>✓ {title}</span>
              <button onClick={dismiss} style={stepGhostBtn}>Done</button>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>{detail}</span>
          </>
        );
      })()}
    </StepCard>
  );
}
