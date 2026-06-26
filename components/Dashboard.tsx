'use client';

import { CashPanVisual } from './CashPanVisual';
import { PocketCard } from './PocketCard';
import { formatSui } from '@/lib/utils';
import type { Balances, Earnings } from '@/lib/read-layer';

interface DashboardProps {
  balances: Balances;
  earnings: Earnings;
}

export function Dashboard({ balances, earnings }: DashboardProps) {
  const total = BigInt(balances.liquid) + BigInt(balances.savingsValue);
  const fillPercent = total > 0n
    ? Number((BigInt(balances.savingsValue) * 10_000n) / total) / 100
    : 0;

  const aprPercent = (Number(earnings.aprBps) / 100).toFixed(0);
  const accruedSui = formatSui(earnings.accrued, 6);
  const totalSui = formatSui(total.toString(), 4);

  const accrued = formatSui(earnings.accrued, 6);
  const accruedLabel = Number(earnings.accrued) > 0 ? `+${accrued} earned` : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%' }}>
      {/* Header stats row */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch' }}>
        <PocketCard
          type="liquid"
          amountBase={balances.liquid}
          label="Spend Pocket"
          sublabel="ready to use"
        />
        <PocketCard
          type="savings"
          amountBase={balances.savingsValue}
          label="Savings Pocket"
          sublabel={accruedLabel}
        />
      </div>

      {/* APR + total row */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          padding: '0.875rem 1.25rem',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '0.75rem',
          border: '1px solid var(--color-border)',
          alignItems: 'center',
        }}
      >
        <Stat label="Total" value={`${totalSui} SUI`} />
        <div style={{ width: '1px', height: '2rem', background: 'var(--color-border)' }} />
        <Stat label="Accrued interest" value={`${accruedSui} SUI`} color="var(--color-savings)" />
        <div style={{ width: '1px', height: '2rem', background: 'var(--color-border)' }} />
        <Stat label="APR" value={`${aprPercent}% / epoch`} />
        <div style={{ width: '1px', height: '2rem', background: 'var(--color-border)' }} />
        <Stat label="Epoch" value={`#${balances.currentEpoch}`} />
      </div>

      {/* The pan — the emotional core */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '1rem 0',
          flex: 1,
        }}
      >
        <CashPanVisual
          fillPercent={fillPercent}
          label={`${formatSui(balances.savingsValue, 4)} SUI`}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flex: 1 }}>
      <div style={{ color: 'var(--color-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ color: color ?? 'var(--color-text)', fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}
