'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Balances, Earnings, ActivityEvent } from '@/lib/read-layer';
import type { BrainProposal } from '@/lib/brain';

export interface Contact {
  label: string;
  address: string;
  createdAt: string;
}

export interface UserSettings {
  buffer: string;
  band: string;
}

export interface AutopilotState {
  enabled: boolean;
  suspended?: boolean;
  suspendReason?: string;
}

export interface AppState {
  balances: Balances | null;
  earnings: Earnings | null;
  activity: ActivityEvent[];
  walletBalance: string;
  proposals: BrainProposal[];
  contacts: Contact[];
  settings: UserSettings;
  autopilot: AutopilotState;
}

interface VaultContextValue extends AppState {
  isLoading: boolean;
  /** Last poll failed — data shown is the previous known-good payload. */
  isStale: boolean;
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
    walletBalance: '0',
    proposals: [],
    contacts: initial?.contacts ?? [],
    settings: DEFAULT_SETTINGS,
    autopilot: { enabled: false },
  });
  // Server-rendered initial data counts as loaded — skeletons are only for
  // a genuinely empty first paint.
  const [isLoading, setIsLoading] = useState(!initial?.balances);
  const [isStale, setIsStale] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (res.ok) {
        // Fresh data swaps in place; previous values are never zeroed by a
        // failed read (the server 503s instead of fabricating zeros).
        setState(await res.json() as AppState);
        setIsStale(false);
        setIsLoading(false);
      } else {
        setIsStale(true);
      }
    } catch {
      setIsStale(true); // network blip — keep showing previous data
    }
  }, []);

  const refresh = useCallback(() => { void fetchState(); }, [fetchState]);

  useEffect(() => {
    const start = () => {
      void fetchState();
      intervalRef.current = setInterval(fetchState, POLL_MS);
    };
    const stop = () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop(); else start();
    };

    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [fetchState]);

  return (
    <VaultDataContext.Provider value={{ ...state, isLoading, isStale, refresh }}>
      {children}
    </VaultDataContext.Provider>
  );
}
