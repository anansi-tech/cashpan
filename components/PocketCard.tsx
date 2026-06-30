'use client';

const COIN_DEC = parseInt(process.env.NEXT_PUBLIC_COIN_DECIMALS ?? '9', 10);
const COIN_FACTOR = 10 ** COIN_DEC;
const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'SUI';

interface PocketCardProps {
  type: 'liquid' | 'savings';
  /** Base-unit balance string (coin-agnostic; factor set by NEXT_PUBLIC_COIN_DECIMALS). */
  amountBase: string;
  label: string;
  sublabel?: string;
}

export function PocketCard({ type, amountBase, label, sublabel }: PocketCardProps) {
  const isSavings = type === 'savings';
  // Savings shows COIN_DEC places (last 3 are the ticking tail); liquid shows 2
  const displayDec = isSavings ? COIN_DEC : 2;
  const raw = (Number(amountBase) / COIN_FACTOR).toFixed(displayDec);
  const mainDigits = isSavings ? raw.slice(0, -3) : raw;
  const tailDigits = isSavings ? raw.slice(-3) : '';

  return (
    <div
      className="pocket-card"
      style={{
        background: isSavings ? 'var(--color-savings-dim)' : 'var(--color-liquid-dim)',
        border: `1px solid ${isSavings ? 'rgba(16,185,129,0.22)' : 'rgba(245,158,11,0.2)'}`,
        borderRadius: '1rem',
        padding: isSavings ? '1.4rem 1.5rem' : '1.25rem 1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.3rem',
        flex: 1,
        minWidth: 0,
        position: 'relative',
        overflow: 'hidden',
        animation: isSavings ? 'savings-glow 4s ease-in-out infinite' : undefined,
      }}
    >
      {/* Savings card: soft radial highlight in the top-right corner */}
      {isSavings && (
        <div
          style={{
            position: 'absolute',
            top: '-20px',
            right: '-20px',
            width: '100px',
            height: '100px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
      )}

      <div
        style={{
          color: 'var(--color-muted)',
          fontSize: '0.72rem',
          textTransform: 'uppercase',
          letterSpacing: '0.09em',
          fontWeight: 600,
        }}
      >
        {label}
      </div>

      <div
        className="pocket-number"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.75rem',
          fontWeight: 700,
          color: isSavings ? 'var(--color-savings-bright)' : 'var(--color-liquid)',
          lineHeight: 1.15,
          letterSpacing: '-0.025em',
          display: 'flex',
          alignItems: 'baseline',
          minWidth: 0,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {mainDigits}
        </span>
        {tailDigits && (
          <span
            style={{
              color: 'rgba(52,211,153,0.45)',
              fontSize: '1.1rem',
              flexShrink: 0,
              letterSpacing: '-0.01em',
            }}
          >
            {tailDigits}
          </span>
        )}
      </div>

      <div style={{ color: 'var(--color-muted-2)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <span>{COIN_SYM}</span>
        {sublabel && (
          <span
            style={{
              color: isSavings ? 'rgba(52,211,153,0.75)' : 'rgba(251,191,36,0.75)',
              fontSize: '0.78rem',
            }}
          >
            · {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}
