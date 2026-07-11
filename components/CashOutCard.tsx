'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useVaultData } from './VaultDataProvider';
import type { VaultTxContext } from '@/lib/vault-tx';
import { executeWalletSendTransaction } from '@/lib/execute-zklogin';
import { humanToBase } from '@/lib/coin-config';
import { formatMoney, formatMoneyHuman } from '@/lib/format';
import { clearCashOut, cashOutStartedAt } from '@/lib/offramp';

const WINDOW_MS = 30 * 60 * 1000;  // Coinbase voids the sell 30 min after "Cash out now"
const NO_ORDER_GIVE_UP_MS = 10 * 60 * 1000; // stop waiting if no order ever appears
const POLL_STEPS_MS = [3_000, 5_000, 8_000, 13_000, 21_000, 30_000]; // then stay at 30s

interface OfframpTx {
  status: string;
  sellAmount?: string;
  currency: string;
  asset: string;
  network: string;
  toAddress?: string;
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
  const [phase, setPhase] = useState<Phase>('waiting');
  const [tx, setTx] = useState<OfframpTx | null>(null);
  const [error, setError] = useState('');
  const pollIdx = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<Phase>('waiting');
  phaseRef.current = phase;

  const startedAt = cashOutStartedAt();

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/offramp/status', { cache: 'no-store' });
      const data = await res.json().catch(() => ({})) as { transaction?: OfframpTx | null; error?: string };
      const t = data.transaction;

      if (t) {
        // Ignore transactions older than this cash-out attempt.
        const createdMs = t.createdAt ? new Date(t.createdAt).getTime() : Date.now();
        if (createdMs >= startedAt - 60_000) {
          setTx(t);
          const s = t.status.toUpperCase();
          const current = phaseRef.current;
          if (s.includes('SUCCESS')) {
            setPhase('paid');
            clearCashOut();
            refresh();
            return; // terminal — stop polling
          }
          if (s.includes('FAILED') || s.includes('EXPIRED') || s.includes('CANCEL')) {
            setPhase(current === 'sent' ? 'failed' : 'expired');
            clearCashOut();
            return; // terminal
          }
          if (current === 'waiting' && t.toAddress && t.sellAmount) {
            // Coinbase has the order — time for the user to sign the send.
            if (Date.now() - createdMs > WINDOW_MS) {
              setPhase('expired');
              clearCashOut();
              return;
            }
            setPhase('confirm');
          }
        }
      }
    } catch { /* transient — keep polling */ }

    // Never poll forever: if no order has appeared within ~10 minutes of the
    // widget opening, give up quietly. The staged USDC sits at the wallet, so
    // the slot reverts to the arrival proposal ("$X arrived — add it back?").
    if (phaseRef.current === 'waiting' && Date.now() - startedAt > NO_ORDER_GIVE_UP_MS) {
      clearCashOut();
      setPhase('gone');
      refresh();
      return;
    }

    const delay = POLL_STEPS_MS[Math.min(pollIdx.current, POLL_STEPS_MS.length - 1)];
    pollIdx.current += 1;
    timerRef.current = setTimeout(() => { void poll(); }, delay);
  }, [refresh, startedAt]);

  useEffect(() => {
    void poll();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [poll]);

  const handleSign = async () => {
    if (!tx?.toAddress || !tx.sellAmount) return;
    setPhase('sending');
    setError('');
    try {
      // Funds were staged to the wallet in step 1 — this is a plain wallet
      // send, so Coinbase's from_address check is trivially the sender.
      await executeWalletSendTransaction(humanToBase(tx.sellAmount), tx.toAddress, vaultCtx.coinType);
      setPhase('sent');
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

  // ── Render ────────────────────────────────────────────────────────────────

  if (phase === 'waiting') {
    return (
      <Card accent="rgba(148,163,184,0.5)">
        <Row>
          <span style={muted}>⏳ Finish your cash-out in Coinbase — we&apos;ll take it from here.</span>
          <button onClick={dismiss} style={ghostBtn}>Dismiss</button>
        </Row>
      </Card>
    );
  }

  if (phase === 'confirm' || phase === 'sending') {
    const amount = tx?.sellAmount ?? '0';
    // Step 2 spends from the WALLET (where step 1 staged the funds).
    const insufficient = BigInt(walletBalance || '0') < humanToBase(amount);
    return (
      <Card accent="var(--color-savings)">
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>
          Cash out ${formatMoneyHuman(amount)} to your bank
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
          Send ${formatMoneyHuman(amount)} {tx?.asset ?? 'USDC'} to Coinbase to complete it.
          Complete within 30 minutes or the cash-out expires.
        </div>
        {insufficient && (
          <div style={{ fontSize: '0.78rem', color: 'rgba(252,165,165,0.9)' }}>
            Your wallet only has ${formatMoney(walletBalance || '0')} staged — the order can&apos;t be covered.
          </div>
        )}
        {error && <div style={{ fontSize: '0.78rem', color: 'rgba(252,165,165,0.9)' }}>{error}</div>}
        <Row>
          <button onClick={dismiss} disabled={phase === 'sending'} style={ghostBtn}>Cancel</button>
          <button
            onClick={handleSign}
            disabled={phase === 'sending' || insufficient}
            style={{ ...primaryBtn, opacity: phase === 'sending' || insufficient ? 0.6 : 1 }}
          >
            {phase === 'sending' ? 'Sending…' : 'Send to Coinbase'}
          </button>
        </Row>
      </Card>
    );
  }

  if (phase === 'sent') {
    return (
      <Card accent="var(--color-savings)">
        <span style={muted}>✓ Sent. Coinbase is processing your payout — this card updates when it completes.</span>
      </Card>
    );
  }

  if (phase === 'paid') {
    return (
      <Card accent="var(--color-savings)">
        <Row>
          <span style={{ fontSize: '0.875rem', color: 'var(--color-savings)', fontWeight: 600 }}>
            ✓ ${formatMoneyHuman(tx?.sellAmount ?? '0')} is on its way to your bank.
          </span>
          <button onClick={dismiss} style={ghostBtn}>Done</button>
        </Row>
      </Card>
    );
  }

  if (phase === 'expired') {
    return (
      <Card accent="rgba(245,158,11,0.6)">
        <Row>
          <span style={muted}>This cash-out expired — start again from Send → Cash out.</span>
          <button onClick={dismiss} style={ghostBtn}>Dismiss</button>
        </Row>
      </Card>
    );
  }

  // failed (incl. price-drop cancel after send — funds land in their Coinbase account)
  return (
    <Card accent="rgba(239,68,68,0.5)">
      <Row>
        <span style={muted}>
          Coinbase couldn&apos;t complete the sale — your {tx?.asset ?? 'USDC'} is in your Coinbase account.
        </span>
        <button onClick={dismiss} style={ghostBtn}>Dismiss</button>
      </Row>
    </Card>
  );
}

// ── Presentational bits ───────────────────────────────────────────────────────

function Card({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '0.625rem',
      padding: '0.75rem 1rem', marginBottom: '0.875rem',
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.15)',
      borderLeft: `3px solid ${accent}`, borderRadius: '0.75rem',
    }}>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>{children}</div>;
}

const muted: CSSProperties = { fontSize: '0.82rem', color: 'var(--color-muted)', flex: 1 };

const ghostBtn: CSSProperties = {
  background: 'transparent', border: '1px solid rgba(148,163,184,0.2)',
  color: 'var(--color-muted)', padding: '0.35rem 0.65rem',
  borderRadius: '0.4rem', fontSize: '0.78rem', cursor: 'pointer', flexShrink: 0,
};

const primaryBtn: CSSProperties = {
  background: 'var(--color-savings)', border: 'none', color: '#0a0f1e',
  padding: '0.35rem 0.875rem', borderRadius: '0.4rem',
  fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
};
