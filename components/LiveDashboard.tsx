'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { CashPanVisual } from './CashPanVisual';
import { useVaultData } from './VaultDataProvider';

const COIN_DEC = parseInt(process.env.NEXT_PUBLIC_COIN_DECIMALS ?? '6', 10);
const COIN_FACTOR = 10 ** COIN_DEC;
const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'USD';

function fmt(base: number, d = 2): string {
  return (base / COIN_FACTOR).toFixed(d);
}

function fmtLocale(base: number, d = 2): string {
  return (base / COIN_FACTOR).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function dispatch(event: string) {
  window.dispatchEvent(new CustomEvent(event));
}

// ─── Quick action button ─────────────────────────────────────────────────────

function QuickBtn({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.3rem',
        padding: '0.75rem 0.5rem',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid var(--color-border)',
        borderRadius: '0.75rem',
        color: 'var(--color-text)',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        minHeight: '56px',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
        e.currentTarget.style.borderColor = 'rgba(148,163,184,0.25)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
        e.currentTarget.style.borderColor = 'var(--color-border)';
      }}
    >
      <span style={{ fontSize: '1.1rem' }}>{icon}</span>
      <span style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.02em', color: 'var(--color-muted)' }}>
        {label}
      </span>
    </button>
  );
}

// ─── Compact pocket row ───────────────────────────────────────────────────────

function PocketRow({
  icon,
  label,
  amountBase,
  sub,
  aprChip,
}: {
  icon: string;
  label: string;
  amountBase: number;
  sub?: string;
  aprChip?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.75rem 1rem',
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid var(--color-border)',
        borderRadius: '0.75rem',
      }}
    >
      <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{icon}</span>
      <span style={{ color: 'var(--color-muted)', fontSize: '0.825rem', fontWeight: 600, minWidth: '3.5rem' }}>
        {label}
      </span>
      <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>
        ${fmtLocale(amountBase)} {COIN_SYM}
      </span>
      {aprChip && (
        <span style={{
          fontSize: '0.7rem', fontWeight: 700,
          color: 'var(--color-savings)', background: 'rgba(16,185,129,0.12)',
          border: '1px solid rgba(16,185,129,0.25)',
          borderRadius: '999px', padding: '0.15rem 0.55rem',
          whiteSpace: 'nowrap',
        }}>
          {aprChip}
        </span>
      )}
      {sub && !aprChip && (
        <span style={{ fontSize: '0.75rem', color: 'var(--color-muted-2)', whiteSpace: 'nowrap' }}>{sub}</span>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LiveDashboard() {
  const { balances, earnings } = useVaultData();

  const authRef = useRef({
    liquid: Number(balances?.liquid ?? 0),
    savingsValue: Number(balances?.savingsValue ?? 0),
  });

  const [displayed, setDisplayed] = useState({
    liquid: Number(balances?.liquid ?? 0),
    savingsValue: Number(balances?.savingsValue ?? 0),
  });

  const rafRef = useRef<number>(0);

  const animate = useCallback(() => {
    const auth = authRef.current;
    setDisplayed((prev) => {
      const sd = auth.savingsValue - prev.savingsValue;
      const ld = auth.liquid - prev.liquid;
      return {
        savingsValue: Math.abs(sd) < 1 ? auth.savingsValue : prev.savingsValue + sd * 0.08,
        liquid: Math.abs(ld) < 1 ? auth.liquid : prev.liquid + ld * 0.06,
      };
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
    };
  }, [balances]);

  const liquid = displayed.liquid;
  const savingsValue = displayed.savingsValue;
  const total = liquid + savingsValue;
  const fillPercent = total > 0 ? (savingsValue / total) * 100 : 0;

  const accrued = earnings ? Math.max(0, Number(earnings.accrued)) : 0;
  const aprBps = earnings ? Number(earnings.aprBps) : 0;
  const aprLabel = aprBps > 0 ? `earning ${(aprBps / 100).toFixed(1)}% APR` : undefined;
  const earnedLabel = accrued > 0 ? `+$${fmt(accrued, 4)} earned` : null;

  if (total === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2.5rem 1rem', textAlign: 'center' }}>
        <div style={{ fontSize: '2rem' }}>💸</div>
        <div style={{ color: 'var(--color-text)', fontWeight: 600, fontSize: '1rem' }}>Add money to get started</div>
        <div style={{ color: 'var(--color-muted)', fontSize: '0.85rem', lineHeight: 1.6, maxWidth: '22rem' }}>
          Share your address to receive {COIN_SYM}, then tap{' '}
          <strong style={{ color: 'var(--color-text)' }}>Add to CashPan</strong> to fund your Spend pocket.
        </div>
        <button
          onClick={() => dispatch('cashpan:show-receive')}
          style={{ background: 'var(--color-savings)', color: '#0a0f1e', border: 'none', borderRadius: '0.625rem', padding: '0.75rem 1.5rem', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', minHeight: '44px' }}
        >
          Receive money →
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Total — lead number */}
      <div style={{ padding: '0.5rem 0 0.25rem' }}>
        <div style={{ color: 'var(--color-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.09em', fontWeight: 600, marginBottom: '0.25rem' }}>
          Total
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2.5rem', fontWeight: 700, color: 'var(--color-text)', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
          ${fmtLocale(total)} <span style={{ fontSize: '1.1rem', color: 'var(--color-muted)', fontWeight: 400 }}>{COIN_SYM}</span>
        </div>
        {earnedLabel && (
          <div style={{ fontSize: '0.85rem', color: 'var(--color-savings)', fontWeight: 600, marginTop: '0.3rem' }}>
            {earnedLabel}
          </div>
        )}
      </div>

      {/* Pocket rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <PocketRow icon="💵" label="Spend" amountBase={liquid} sub="ready to use" />
        <PocketRow icon="💰" label="Save" amountBase={savingsValue} aprChip={aprLabel} />
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <QuickBtn icon="📥" label="Receive" onClick={() => dispatch('cashpan:show-receive')} />
        <QuickBtn icon="↗" label="Send" onClick={() => dispatch('cashpan:show-send')} />
        <QuickBtn icon="⇄" label="Move" onClick={() => dispatch('cashpan:show-chat')} />
      </div>

      {/* CashPan visual */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '0.5rem 0' }}>
        <CashPanVisual fillPercent={fillPercent} label={`$${fmt(savingsValue, 2)} ${COIN_SYM}`} />
      </div>
    </div>
  );
}
