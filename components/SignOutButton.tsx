'use client';

import { useAuth } from './AuthProvider';

export function SignOutButton({ name }: { name: string }) {
  const { signOut } = useAuth();

  return (
    <button
      onClick={signOut}
      title="Sign out"
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--color-muted)',
        fontSize: '0.78rem',
        fontFamily: 'var(--font-mono)',
        padding: '0.2rem 0.4rem',
        borderRadius: '0.3rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.35rem',
      }}
    >
      <span>{name}</span>
      <span style={{ opacity: 0.5 }}>↩</span>
    </button>
  );
}
