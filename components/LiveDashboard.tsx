'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { CashPanVisual } from './CashPanVisual';
import { PocketCard } from './PocketCard';
import { useVaultData } from './VaultDataProvider';

const COIN_DEC = parseInt(process.env.NEXT_PUBLIC_COIN_DECIMALS ?? '9', 10);
const COIN_FACTOR = 10 ** COIN_DEC;
const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'SUI';


function fmt(base: number, d = 2): string {
  return (base / COIN_FACTOR).toFixed(d);
}

export function LiveDashboard() {
  const { balances, earnings } = useVaultData();

  const authRef = useRef({
    liquid: Number(balances?.liquid ?? 0),
    savingsValue: Number(balances?.savingsValue ?? 0),
    currentEpoch: balances?.currentEpoch ?? '0',
  });

  const [displayed, setDisplayed] = useState({
    liquid: Number(balances?.liquid ?? 0),
    savingsValue: Number(balances?.savingsValue ?? 0),
    currentEpoch: balances?.currentEpoch ?? '0',
  });

  const rafRef = useRef<number>(0);

  const animate = useCallback(() => {
    const auth = authRef.current;
    setDisplayed((prev) => {
      const savingsDiff = auth.savingsValue - prev.savingsValue;
      const easedSavings = Math.abs(savingsDiff) < 1 ? auth.savingsValue : prev.savingsValue + savingsDiff * 0.08;
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

  useEffect(() => {
    if (!balances) return;
    authRef.current = {
      liquid: Number(balances.liquid),
      savingsValue: Number(balances.savingsValue),
      currentEpoch: balances.currentEpoch,
    };
  }, [balances]);

  const liquid = displayed.liquid;
  const savingsValue = displayed.savingsValue;
  const total = liquid + savingsValue;
  const fillPercent = total > 0 ? (savingsValue / total) * 100 : 0;

  const accrued = earnings ? Math.max(0, Number(earnings.accrued)) : 0;
  const accruedLabel = accrued > 0 ? `+$${fmt(accrued, 4)} earned` : undefined;

  const annualAprPct = earnings && Number(earnings.aprBps) > 0
    ? (Number(earnings.aprBps) / 100).toFixed(1)
    : '–';

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
        <Stat label="Yield" value={annualAprPct !== '–' ? `~${annualAprPct}% APR (variable)` : '–'} />
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
