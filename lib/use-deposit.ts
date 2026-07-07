import { useState } from 'react';
import { useVaultData } from '@/components/VaultDataProvider';
import { executeDepositTransaction } from '@/lib/execute-zklogin';
import type { VaultTxContext } from '@/lib/vault-tx';

export type DepositState = 'idle' | 'depositing' | 'success' | 'error';

export function useDeposit(
  vaultCtx: Pick<VaultTxContext, 'packageId' | 'coinType' | 'vaultId'>,
) {
  const { walletBalance, refresh } = useVaultData();
  const [state, setState] = useState<DepositState>('idle');
  const [error, setError] = useState('');
  const [depositedAmount, setDepositedAmount] = useState(0n);

  const totalOwned = BigInt(walletBalance || '0');

  const deposit = async () => {
    const amount = BigInt(walletBalance || '0');
    if (amount === 0n || state === 'depositing') return;
    setDepositedAmount(amount);
    setState('depositing');
    setError('');
    try {
      await executeDepositTransaction(amount, vaultCtx);
      setState('success');
      refresh();
    } catch (err) {
      console.error('[deposit]', err);
      const msg = (err instanceof Error ? err.message : '').toLowerCase();
      setError(
        msg.includes('sponsor')
          ? "Couldn't sponsor. Try again."
          : msg.includes('network') || msg.includes('fetch')
          ? 'Network issue. Try again.'
          : 'Deposit failed. Try again.',
      );
      setState('error');
    }
  };

  return { totalOwned, depositedAmount, state, error, deposit };
}
