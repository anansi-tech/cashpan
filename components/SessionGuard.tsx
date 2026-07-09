'use client';

import { useEffect } from 'react';
import { getMaxEpoch, getSession } from '@/lib/auth';
import { useVaultData } from './VaultDataProvider';

/**
 * Mounts inside VaultDataProvider. Proactively forces re-login when the
 * zkLogin ephemeral key's maxEpoch is reached, before the user's next
 * transaction attempt would fail with a signature error.
 */
export function SessionGuard() {
  const { balances } = useVaultData();

  useEffect(() => {
    if (!balances?.currentEpoch) return;
    if (!getSession()) return; // no client session — AuthProvider handles this case
    const maxEpoch = getMaxEpoch();
    if (!maxEpoch) return;
    if (Number(balances.currentEpoch) > maxEpoch - 1) {
      window.dispatchEvent(new CustomEvent('cashpan:session-expired'));
    }
  }, [balances?.currentEpoch]);

  return null;
}
