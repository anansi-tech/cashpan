'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { CashPanVisual } from './CashPanVisual';
import { PocketCard } from './PocketCard';
import { formatSui } from '@/lib/utils';
import type { Balances, Earnings } from '@/lib/read-layer';

interface LiveDashboardProps {
  /** Values fetched server-side on first render */
  initial: {
    balances: Balances;
    earnings: Earnings;
  };
}

/**
 * Projects savings value forward in wall-clock time between on-chain polls.
 *
 * On-chain accrual is epoch-based (steps once per ~24h epoch), but the UI
 * animates continuously as a projection. Reconciles toward the authoritative
 * on-chain value with exponential easing on each poll.
 *
 * Formula mirrors computeCurrentValue in src/sense.ts and lib/read-layer.ts.
 */
function projectSavings(
  principal: number,      // MIST
  rateBps: number,
  periodEpochs: number,
  elapsedMs: number,
): number {
  // epochDurationMs is approximate — testnet epochs are ~24h
  const epochDurationMs = 24 * 60 * 60 * 1000;
  const elapsedEpochs = elapsedMs / epochDurationMs;
  const interest = (principal * rateBps * elapsedEpochs) / (10_000 * periodEpochs);
  return principal + interest;
}

export function LiveDashboard({ initial }: LiveDashboardProps) {
  // Authoritative values from the last poll
  const authRef = useRef({
    liquid: Number(initial.balances.liquid),
    savingsPrincipal: Number(initial.balances.savingsPrincipal),
    savingsValue: Number(initial.balances.savingsValue),
    rateBps: Number(initial.balances.rateBps),
    periodEpochs: Number(initial.balances.periodEpochs),
    currentEpoch: initial.balances.currentEpoch,
    pollTime: Date.now(),
  });

  // Display state: what the user sees (projected + eased)
  const [displayed, setDisplayed] = useState({
    liquid: Number(initial.balances.liquid),
    savingsValue: Number(initial.balances.savingsValue),
    currentEpoch: initial.balances.currentEpoch,
  });

  const rafRef = useRef<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Continuous animation loop
  const animate = useCallback(() => {
    const auth = authRef.current;
    const elapsed = Date.now() - auth.pollTime;

    // Project current savings based on elapsed time since last poll
    const projected = auth.savingsPrincipal > 0
      ? projectSavings(auth.savingsPrincipal, auth.rateBps, auth.periodEpochs, elapsed)
      : auth.savingsValue;

    setDisplayed((prev) => {
      // Ease displayed value toward the projection (fast when far, slow when close)
      const diff = projected - prev.savingsValue;
      const eased = Math.abs(diff) < 1 ? projected : prev.savingsValue + diff * 0.08;
      return {
        ...prev,
        savingsValue: eased,
        currentEpoch: auth.currentEpoch,
      };
    });

    rafRef.current = requestAnimationFrame(animate);
  }, []);

  // Start animation loop
  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animate]);

  // Poll /api/balances every 5s
  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/balances', { cache: 'no-store' });
      if (!res.ok) return;
      const data: Balances = await res.json();

      // Update authoritative values; animation loop will ease toward new projection
      authRef.current = {
        liquid: Number(data.liquid),
        savingsPrincipal: Number(data.savingsPrincipal),
        savingsValue: Number(data.savingsValue),
        rateBps: Number(data.rateBps),
        periodEpochs: Number(data.periodEpochs),
        currentEpoch: data.currentEpoch,
        pollTime: Date.now(),
      };
      // Snap liquid immediately (it doesn't animate between polls)
      setDisplayed((prev) => ({ ...prev, liquid: Number(data.liquid) }));
    } catch {
      // Network errors are silent — just keep showing the last good values
    }
  }, []);

  useEffect(() => {
    pollRef.current = setInterval(poll, 5_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [poll]);

  // Derived display values
  const liquid = displayed.liquid;
  const savingsValue = displayed.savingsValue;
  const total = liquid + savingsValue;
  const fillPercent = total > 0 ? (savingsValue / total) * 100 : 0;

  const savings = initial.balances;
  const accrued = savingsValue - Number(initial.balances.savingsPrincipal);
  const accruedLabel = accrued > 0
    ? `+${(accrued / 1e9).toFixed(6)} earned`
    : undefined;

  const earnings: Earnings = {
    accrued: Math.max(0, accrued).toFixed(0),
    aprBps: initial.earnings.aprBps,
  };

  const aprPercent = (Number(earnings.aprBps) / 100).toFixed(0);
  const accruedSui = (accrued / 1e9).toFixed(6);
  const totalSui = formatSui(total.toFixed(0), 4);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%' }}>
      {/* Pocket cards */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch' }}>
        <PocketCard
          type="liquid"
          amountMist={liquid.toFixed(0)}
          label="Spend Pocket"
          sublabel="ready to use"
        />
        <PocketCard
          type="savings"
          amountMist={savingsValue.toFixed(0)}
          label="Savings Pocket"
          sublabel={accruedLabel}
        />
      </div>

      {/* Stats row */}
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
        <Divider />
        <Stat label="Accrued" value={`${accruedSui} SUI`} color="var(--color-savings)" />
        <Divider />
        <Stat label="APR" value={`${aprPercent}% / epoch`} />
        <Divider />
        <Stat label="Epoch" value={`#${displayed.currentEpoch}`} />
      </div>

      {/* The pan */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem 0', flex: 1 }}>
        <CashPanVisual
          fillPercent={fillPercent}
          label={`${(savingsValue / 1e9).toFixed(4)} SUI`}
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

function Divider() {
  return <div style={{ width: '1px', height: '2rem', background: 'var(--color-border)' }} />;
}
