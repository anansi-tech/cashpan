'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface UserSwitcherProps {
  currentUser: string;
}

/**
 * Dev identity switcher — Block 1 only.
 * Sets cashpan-user cookie on mount so all client-side fetches (polling,
 * chat, execute) carry the same identity as the SSR render.
 * Replaced in Block 2 when zkLogin lands.
 */
export function UserSwitcher({ currentUser }: UserSwitcherProps) {
  const router = useRouter();

  // Stamp the cookie whenever the resolved user changes (including first render).
  // This makes /api/balances polling, /api/chat, and /api/execute all pick up
  // the right vault without prop-drilling.
  useEffect(() => {
    document.cookie = `cashpan-user=${encodeURIComponent(currentUser)}; path=/; SameSite=Lax`;
  }, [currentUser]);

  function switchTo(key: string) {
    if (!key || key === currentUser) return;
    document.cookie = `cashpan-user=${encodeURIComponent(key)}; path=/; SameSite=Lax`;
    router.push(`/?user=${encodeURIComponent(key)}`);
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        fontSize: '0.75rem',
        color: 'var(--color-muted)',
      }}
    >
      <span style={{ opacity: 0.6 }}>dev:</span>
      <input
        defaultValue={currentUser}
        onBlur={(e) => switchTo(e.target.value.trim())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') switchTo((e.currentTarget as HTMLInputElement).value.trim());
        }}
        style={{
          background: 'transparent',
          border: '1px solid var(--color-border)',
          borderRadius: '0.35rem',
          padding: '0.2rem 0.45rem',
          color: 'var(--color-text)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.75rem',
          width: '80px',
          outline: 'none',
        }}
        title="Type an identity key and press Enter to switch vaults"
      />
    </div>
  );
}
