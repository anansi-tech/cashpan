'use client';

import { useEffect } from 'react';
import { useVaultData } from './VaultDataProvider';
import { setOnrampPending } from '@/lib/onramp';
import { isCashOutActive } from '@/lib/offramp';

/**
 * Handles the user returning from Coinbase Onramp. Both paths converge on the
 * same outcome: the OnrampProgress stepper in the proposal slot advances
 * (② on the way → ③ Add) as the arrival proposal lands.
 *
 * - Desktop: /onramp/callback (popup) posts {type:'onramp'} and closes.
 * - Mobile: the redirect lands on /?onramp_result=… (param stripped after read).
 */
export function OnrampReturnListener() {
  const { refresh } = useVaultData();

  useEffect(() => {
    const handleReturn = () => {
      // The callback relay is shared with the offramp (sell) flow — a return
      // during an active cash-out belongs to CashOutCard, not the buy path.
      if (isCashOutActive()) { refresh(); return; }
      setOnrampPending(); // idempotent — openOnramp already set it pre-launch
      refresh();          // immediate poll instead of waiting out the 5s tick
    };

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if ((e.data as { type?: string } | null)?.type === 'onramp') handleReturn();
    };
    window.addEventListener('message', onMessage);

    const params = new URLSearchParams(window.location.search);
    if (params.has('onramp_result')) {
      handleReturn();
      params.delete('onramp_result');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }

    return () => window.removeEventListener('message', onMessage);
  }, [refresh]);

  return null;
}
