/**
 * Coinbase Offramp — client half. The flow INVERTS onramp: the user picks the
 * amount in Coinbase's widget; we then poll status, get amount + deposit
 * address, and the user signs one on-chain send (vault withdraw → transfer).
 */

const ACTIVE_KEY = 'cashpan_offramp_active'; // Date.now() when the widget opened

export function setCashOutActive(): void {
  if (typeof window !== 'undefined') sessionStorage.setItem(ACTIVE_KEY, String(Date.now()));
}

export function isCashOutActive(): boolean {
  return typeof window !== 'undefined' && sessionStorage.getItem(ACTIVE_KEY) !== null;
}

export function cashOutStartedAt(): number {
  if (typeof window === 'undefined') return 0;
  return Number(sessionStorage.getItem(ACTIVE_KEY) ?? 0);
}

export function clearCashOut(): void {
  if (typeof window !== 'undefined') sessionStorage.removeItem(ACTIVE_KEY);
}

/** Open the Coinbase sell widget. Same popup/redirect pattern as onramp. */
export async function openCashOut(): Promise<void> {
  const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
  const popup = isDesktop ? window.open('about:blank', '_blank', 'popup,width=460,height=720') : null;

  try {
    const res = await fetch('/api/offramp/session', { method: 'POST' });
    const data = await res.json().catch(() => ({})) as { url?: string; error?: string };
    if (!res.ok || !data.url) throw new Error(data.error ?? 'Could not start the cash-out flow');

    setCashOutActive();
    if (popup && !popup.closed) {
      popup.location.href = data.url;
    } else {
      window.location.href = data.url;
    }
  } catch (err) {
    popup?.close();
    throw err;
  }
}
