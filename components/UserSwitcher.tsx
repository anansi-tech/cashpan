'use client';

import { useRouter } from 'next/navigation';

interface UserSwitcherProps {
  currentUser: string;
}

/**
 * Dev identity switcher — Block 1 only.
 * Appends ?user=<key> to navigate between registered vaults.
 * Replaced in Block 2 when zkLogin lands.
 */
export function UserSwitcher({ currentUser }: UserSwitcherProps) {
  const router = useRouter();

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const key = e.target.value.trim();
    if (!key) return;
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
        onBlur={onChange}
        onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const key = (e.currentTarget as HTMLInputElement).value.trim();
          if (key) router.push(`/?user=${encodeURIComponent(key)}`);
        }
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
