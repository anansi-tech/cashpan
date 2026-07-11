'use client';

/**
 * Coinbase Onramp return target (redirectUrl). A dumb relay — no auth, no data:
 * - Desktop popup: post the result back to the opener and close.
 * - Mobile redirect (no opener): replace into the app; the main window's
 *   OnrampReturnListener consumes the onramp_result param.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function OnrampCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const result = window.location.search.replace(/^\?/, '');
    if (window.opener) {
      (window.opener as Window).postMessage({ type: 'onramp', result }, window.location.origin);
      window.close();
    } else {
      router.replace(result ? `/?onramp_result=${encodeURIComponent(result)}` : '/');
    }
  }, [router]);

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-bg)', color: 'var(--color-muted)',
      fontFamily: 'var(--font-mono)', fontSize: '0.875rem',
    }}>
      Returning to CashPan…
    </div>
  );
}
