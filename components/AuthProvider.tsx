'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { getSession, signOut as authSignOut, type ZkLoginSession } from '@/lib/auth';

interface AuthContextValue {
  user: ZkLoginSession | null;
  loading: boolean;
  signOut: () => Promise<void>;
  setSession: (session: ZkLoginSession) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ZkLoginSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(getSession());
    setLoading(false);
  }, []);

  const signOut = useCallback(async () => {
    await authSignOut();
    setUser(null);
    window.location.href = '/';
  }, []);

  const setSession = useCallback((session: ZkLoginSession) => {
    setUser(session);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signOut, setSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
