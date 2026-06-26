'use client';

import { useState } from 'react';

function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const display = `${value.slice(0, 8)}…${value.slice(-6)}`;

  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      onClick={copy}
      title={`Copy ${label}: ${value}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.35rem',
        background: 'transparent',
        border: '1px solid var(--color-border)',
        borderRadius: '0.4rem',
        padding: '0.2rem 0.55rem',
        cursor: 'pointer',
        color: copied ? 'var(--color-savings)' : 'var(--color-muted)',
        fontSize: '0.72rem',
        fontFamily: 'var(--font-mono)',
        transition: 'color 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: 'var(--color-muted-2)', fontFamily: 'inherit', fontSize: '0.68rem' }}>
        {label}
      </span>
      {copied ? '✓ copied' : display}
    </button>
  );
}

export function AccountBar({ vaultId, address }: { vaultId: string; address: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      padding: '0.3rem 1.5rem',
      borderBottom: '1px solid var(--color-border)',
      background: 'rgba(255,255,255,0.02)',
    }}>
      <CopyChip label="vault " value={vaultId} />
      <CopyChip label="addr  " value={address} />
    </div>
  );
}
