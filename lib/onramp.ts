/**
 * Coinbase Onramp — client half. Fetches a hosted onramp URL from our authed
 * session route and opens it (popup on desktop, redirect on mobile).
 *
 * Everything after the money lands is the EXISTING pipeline: the 5s state poll
 * sees walletBalance > 0 → WalletArrivalStrip appears → one-tap Add → Spend.
 */

const PENDING_KEY = 'cashpan_onramp_pending';

// window guards: these are read during render, which also runs on the SSR pass.
export function setOnrampPending(): void {
  if (typeof window !== 'undefined') sessionStorage.setItem(PENDING_KEY, String(Date.now()));
}

export function isOnrampPending(): boolean {
  return typeof window !== 'undefined' && sessionStorage.getItem(PENDING_KEY) !== null;
}

export function clearOnrampPending(): void {
  if (typeof window !== 'undefined') sessionStorage.removeItem(PENDING_KEY);
}

/**
 * Open the Coinbase Onramp for the signed-in user.
 * Desktop: popup (opened synchronously inside the tap so blockers allow it,
 * then navigated once the URL arrives). Mobile: full redirect.
 */
export async function openOnramp(presetFiatAmount?: number): Promise<void> {
  const isDesktop = window.matchMedia('(min-width: 1024px)').matches;

  // Must be opened inside the user gesture — an await first gets it blocked.
  const popup = isDesktop ? window.open('about:blank', '_blank', 'popup,width=460,height=720') : null;

  try {
    const res = await fetch('/api/onramp/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(presetFiatAmount && presetFiatAmount > 0 ? { presetFiatAmount } : {}),
    });
    const data = await res.json().catch(() => ({})) as { url?: string; error?: string };
    if (!res.ok || !data.url) throw new Error(data.error ?? 'Could not start the payment flow');

    setOnrampPending();
    if (popup && !popup.closed) {
      popup.location.href = data.url;
    } else {
      window.location.href = data.url; // mobile, or popup was blocked
    }
  } catch (err) {
    popup?.close();
    throw err;
  }
}
