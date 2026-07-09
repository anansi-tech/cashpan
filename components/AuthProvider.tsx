'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
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
  const expiredRef = useRef(false);

  // Unified forced-expiry handler — clears everything and redirects to sign-in with a flash message.
  const forceExpiredSignOut = useCallback(async () => {
    if (expiredRef.current) return; // prevent double-fire
    expiredRef.current = true;
    sessionStorage.setItem('cashpan_flash', 'Session expired — sign in again');
    await authSignOut(); // clears sessionStorage keys + DELETE /api/auth/session
    window.location.href = '/';
  }, []);

  // Mount: if sessionStorage is empty but the server cookie is still set, we're in a
  // stale-cookie/missing-ephemeral-key mismatch — force a clean sign-out.
  useEffect(() => {
    const session = getSession();
    if (session) {
      setUser(session);
      setLoading(false);
      return;
    }

    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((data: { has_session: boolean }) => {
        if (data.has_session) {
          void forceExpiredSignOut();
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for cashpan:session-expired dispatched by execute-zklogin or SessionGuard.
  useEffect(() => {
    const handler = () => { void forceExpiredSignOut(); };
    window.addEventListener('cashpan:session-expired', handler);
    return () => window.removeEventListener('cashpan:session-expired', handler);
  }, [forceExpiredSignOut]);

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
