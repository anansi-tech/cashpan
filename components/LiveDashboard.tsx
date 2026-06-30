'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { CashPanVisual } from './CashPanVisual';
import { PocketCard } from './PocketCard';
import type { Balances, Earnings } from '@/lib/read-layer';

const COIN_DEC = parseInt(process.env.NEXT_PUBLIC_COIN_DECIMALS ?? '9', 10);
const COIN_FACTOR = 10 ** COIN_DEC;
const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'SUI';

interface LiveDashboardProps {
  initial: {
    balances: Balances;
    earnings: Earnings;
  };
}

/**
 * Projects savings value forward in wall-clock time between on-chain polls.
 * Formula mirrors computeCurrentValue in src/sense.ts and lib/read-layer.ts.
 */
function projectSavings(
  principal: number,  // base units
  rateBps: number,
  periodEpochs: number,
  elapsedMs: number,
): number {
  const epochDurationMs = 24 * 60 * 60 * 1000; // ~24h testnet epoch
  const elapsedEpochs = elapsedMs / epochDurationMs;
  const interest = (principal * rateBps * elapsedEpochs) / (10_000 * periodEpochs);
  return principal + interest;
}

function fmt(base: number, d = 2): string {
  return (base / COIN_FACTOR).toFixed(d);
}

export function LiveDashboard({ initial }: LiveDashboardProps) {
  const authRef = useRef({
    liquid: Number(initial.balances.liquid),
    savingsPrincipal: Number(initial.balances.savingsPrincipal),
    savingsValue: Number(initial.balances.savingsValue),
    rateBps: Number(initial.balances.rateBps),
    periodEpochs: Number(initial.balances.periodEpochs),
    currentEpoch: initial.balances.currentEpoch,
    pollTime: Date.now(),
  });

  const [displayed, setDisplayed] = useState({
    liquid: Number(initial.balances.liquid),
    savingsValue: Number(initial.balances.savingsValue),
    savingsPrincipal: Number(initial.balances.savingsPrincipal),
    currentEpoch: initial.balances.currentEpoch,
  });

  const rafRef = useRef<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const animate = useCallback(() => {
    const auth = authRef.current;
    const elapsed = Date.now() - auth.pollTime;
    const projected = auth.savingsPrincipal > 0
      ? projectSavings(auth.savingsPrincipal, auth.rateBps, auth.periodEpochs, elapsed)
      : auth.savingsValue;
    setDisplayed((prev) => {
      const savingsDiff = projected - prev.savingsValue;
      const easedSavings = Math.abs(savingsDiff) < 1 ? projected : prev.savingsValue + savingsDiff * 0.08;
      const liquidDiff = auth.liquid - prev.liquid;
      const easedLiquid = Math.abs(liquidDiff) < 1 ? auth.liquid : prev.liquid + liquidDiff * 0.06;
      return { ...prev, savingsValue: easedSavings, liquid: easedLiquid, currentEpoch: auth.currentEpoch };
    });
    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animate]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/balances', { cache: 'no-store' });
      if (!res.ok) return;
      const data: Balances = await res.json();
      authRef.current = {
        liquid: Number(data.liquid),
        savingsPrincipal: Number(data.savingsPrincipal),
        savingsValue: Number(data.savingsValue),
        rateBps: Number(data.rateBps),
        periodEpochs: Number(data.periodEpochs),
        currentEpoch: data.currentEpoch,
        pollTime: Date.now(),
      };
      setDisplayed((prev) => ({ ...prev, liquid: Number(data.liquid), savingsPrincipal: Number(data.savingsPrincipal) }));
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    pollRef.current = setInterval(poll, 5_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [poll]);

  useEffect(() => {
    const handler = () => { void poll(); };
    window.addEventListener('cashpan:refresh', handler);
    return () => window.removeEventListener('cashpan:refresh', handler);
  }, [poll]);

  const liquid = displayed.liquid;
  const savingsValue = displayed.savingsValue;
  const total = liquid + savingsValue;
  const fillPercent = total > 0 ? (savingsValue / total) * 100 : 0;

  const principal = displayed.savingsPrincipal;
  const accrued = Math.max(0, savingsValue - principal);
  const accruedLabel = accrued > 0 ? `+$${fmt(accrued, 4)} earned` : undefined;

  const aprPct = (Number(initial.earnings.aprBps) / 100).toFixed(1).replace(/\.0$/, '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%' }}>
      <div className="pocket-cards" style={{ display: 'flex', gap: '1rem', alignItems: 'stretch' }}>
        <PocketCard
          type="liquid"
          amountBase={liquid.toFixed(0)}
          label="Spend"
          sublabel="ready to use"
        />
        <PocketCard
          type="savings"
          amountBase={savingsValue.toFixed(0)}
          label="Save"
          sublabel={accruedLabel}
        />
      </div>

      <div
        className="stats-row"
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
        <Stat label="Total" value={`$${fmt(total, 2)} ${COIN_SYM}`} />
        <Divider />
        <Stat label="Earned" value={`$${fmt(accrued, 4)} ${COIN_SYM}`} color="var(--color-savings)" />
        <Divider />
        <Stat label="Yield" value={`${aprPct}% / epoch`} />
        <Divider />
        <Stat label="Epoch" value={`#${displayed.currentEpoch}`} />
      </div>

      {total === 0 ? (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: '1rem', padding: '2rem 1rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '2rem' }}>💸</div>
          <div style={{ color: 'var(--color-text)', fontWeight: 600, fontSize: '1rem' }}>
            Add money to get started
          </div>
          <div style={{ color: 'var(--color-muted)', fontSize: '0.85rem', lineHeight: 1.6, maxWidth: '22rem' }}>
            Share your address to receive {COIN_SYM}, then tap{' '}
            <strong style={{ color: 'var(--color-text)' }}>Add to CashPan</strong> to fund your Spend pocket.
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('cashpan:show-receive'))}
            style={{
              background: 'var(--color-savings)', color: '#0a0f1e',
              border: 'none', borderRadius: '0.625rem',
              padding: '0.75rem 1.5rem', fontSize: '0.9rem', fontWeight: 700,
              cursor: 'pointer', minHeight: '44px',
            }}
          >
            Receive money →
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem 0', flex: 1 }}>
          <CashPanVisual
            fillPercent={fillPercent}
            label={`$${fmt(savingsValue, 2)} ${COIN_SYM}`}
          />
        </div>
      )}
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
  return <div className="stats-divider" style={{ width: '1px', height: '2rem', background: 'var(--color-border)' }} />;
}
