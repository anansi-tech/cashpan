'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Balances, Earnings, ActivityEvent } from '@/lib/read-layer';
import type { BrainProposal, WalletCoin } from '@/lib/brain';

export interface Contact {
  label: string;
  address: string;
  createdAt: string;
}

export interface UserSettings {
  buffer: string;
  band: string;
}

export interface AppState {
  balances: Balances | null;
  earnings: Earnings | null;
  activity: ActivityEvent[];
  walletCoins: WalletCoin[];
  proposals: BrainProposal[];
  contacts: Contact[];
  settings: UserSettings;
}

interface VaultContextValue extends AppState {
  isLoading: boolean;
  refresh: () => void;
}

const VaultDataContext = createContext<VaultContextValue | null>(null);

export function useVaultData(): VaultContextValue {
  const ctx = useContext(VaultDataContext);
  if (!ctx) throw new Error('useVaultData must be used within VaultDataProvider');
  return ctx;
}

const DEFAULT_SETTINGS: UserSettings = { buffer: '50', band: '5' };
const POLL_MS = 5_000;

export function VaultDataProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: Partial<AppState>;
}) {
  const [state, setState] = useState<AppState>({
    balances: initial?.balances ?? null,
    earnings: initial?.earnings ?? null,
    activity: initial?.activity ?? [],
    walletCoins: [],
    proposals: [],
    contacts: initial?.contacts ?? [],
    settings: DEFAULT_SETTINGS,
  });
  const [isLoading, setIsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.ok) setState(await res.json() as AppState);
    } catch { /* degrade silently */ }
    setIsLoading(false);
  }, []);

  const refresh = useCallback(() => { void fetchState(); }, [fetchState]);

  useEffect(() => {
    void fetchState();
    intervalRef.current = setInterval(fetchState, POLL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchState]);

  return (
    <VaultDataContext.Provider value={{ ...state, isLoading, refresh }}>
      {children}
    </VaultDataContext.Provider>
  );
}
