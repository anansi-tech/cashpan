'use client';

import { formatSui } from '@/lib/utils';

interface PocketCardProps {
  type: 'liquid' | 'savings';
  amountMist: string;
  label: string;
  sublabel?: string;
}

export function PocketCard({ type, amountMist, label, sublabel }: PocketCardProps) {
  const isSavings = type === 'savings';
  const sui = formatSui(amountMist, 6);

  return (
    <div
      style={{
        background: isSavings ? 'var(--color-savings-dim)' : 'var(--color-liquid-dim)',
        border: `1px solid ${isSavings ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}`,
        borderRadius: '1rem',
        padding: '1.25rem 1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={{ color: 'var(--color-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
        {label}
      </div>

      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.75rem',
          fontWeight: 700,
          color: isSavings ? 'var(--color-savings)' : 'var(--color-liquid)',
          lineHeight: 1.2,
          letterSpacing: '-0.02em',
        }}
      >
        {sui}
      </div>

      <div style={{ color: 'var(--color-muted-2)', fontSize: '0.8rem' }}>
        SUI
        {sublabel && (
          <span style={{ color: isSavings ? 'rgba(52,211,153,0.7)' : 'rgba(251,191,36,0.7)', marginLeft: '0.5rem' }}>
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}
