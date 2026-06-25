'use client';

import { formatSui } from '@/lib/utils';

interface PocketCardProps {
  type: 'liquid' | 'savings';
  amountMist: string;
  label: string;
  sublabel?: string;
  /** Override decimal places (default: 4 liquid, 9 savings) */
  decimals?: number;
}

export function PocketCard({ type, amountMist, label, sublabel, decimals }: PocketCardProps) {
  const isSavings = type === 'savings';
  const d = decimals ?? (isSavings ? 9 : 4);
  const raw = (Number(amountMist) / 1e9).toFixed(d);
  // For savings, split the number so we can highlight the ticking tail digits
  const mainDigits = isSavings ? raw.slice(0, -3) : raw;
  const tailDigits = isSavings ? raw.slice(-3) : '';

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
          fontSize: isSavings ? '1.35rem' : '1.75rem',
          fontWeight: 700,
          color: isSavings ? 'var(--color-savings)' : 'var(--color-liquid)',
          lineHeight: 1.2,
          letterSpacing: '-0.02em',
          display: 'flex',
          alignItems: 'baseline',
        }}
      >
        <span>{mainDigits}</span>
        {tailDigits && (
          <span style={{ color: 'rgba(52,211,153,0.55)', fontSize: '1.1rem' }}>
            {tailDigits}
          </span>
        )}
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
