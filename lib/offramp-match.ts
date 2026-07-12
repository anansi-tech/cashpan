/**
 * Pure decision core for the cash-out status poll.
 *
 * Regression fixed here: a PRIOR terminal transaction was matched as "the"
 * transaction before the new order propagated, which terminated a live
 * session and let the arrival-recovery card race a real cash-out. Historical
 * transactions can never satisfy, clear, or terminate a session: only
 * transactions created at/after the session start (minus a small clock-skew
 * allowance) are considered at all.
 */

export const CLOCK_SKEW_MS = 2 * 60 * 1000;
export const ORDER_WINDOW_MS = 30 * 60 * 1000; // Coinbase voids the sell 30 min after "Cash out now"

export interface PolledTx {
  status: string;
  toAddress?: string;
  sellAmount?: string;
  createdAt?: string;
}

export type PollDecision =
  | 'wait'      // nothing usable yet (no tx, or only historical ones) — keep polling
  | 'confirm'   // this session's order exists — user must sign the send
  | 'paid'      // terminal success
  | 'failed'    // terminal failure after our send
  | 'expired';  // order died before our send (incl. 30-min window)

export function classifyOfframpPoll(
  tx: PolledTx | null,
  sessionStartMs: number,
  phase: 'waiting' | 'confirm' | 'sending' | 'sent',
  nowMs: number,
): PollDecision {
  if (!tx) return 'wait';

  // Session gate: historical transactions are invisible, full stop.
  const createdMs = tx.createdAt ? new Date(tx.createdAt).getTime() : nowMs;
  if (!(createdMs >= sessionStartMs - CLOCK_SKEW_MS)) return 'wait';

  const s = tx.status.toUpperCase();
  if (s.includes('SUCCESS')) return 'paid';
  if (s.includes('FAILED') || s.includes('EXPIRED') || s.includes('CANCEL')) {
    return phase === 'sent' ? 'failed' : 'expired';
  }
  if (phase === 'waiting' && tx.toAddress && tx.sellAmount) {
    return nowMs - createdMs > ORDER_WINDOW_MS ? 'expired' : 'confirm';
  }
  return 'wait';
}
