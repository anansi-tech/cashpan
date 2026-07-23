'use client';

import { useEffect, useRef } from 'react';
import { useVaultData } from './VaultDataProvider';
import { formatMoney, floorToDecimals } from '@/lib/format';
import { pendingSuggestionPockets } from './ProposalBanner';

const COIN_DEC = parseInt(process.env.NEXT_PUBLIC_COIN_DECIMALS ?? '6', 10);
const COIN_FACTOR = 10 ** COIN_DEC;
const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'USD';

// Floor to whole cents BEFORE summing so Spend + Save always equals Total on screen.
// (formatMoney floors again at display time — identity on already-floored values.)
const CENT_BASE = COIN_FACTOR / 100;
function floorCents(base: number): number {
  return Math.floor(base / CENT_BASE) * CENT_BASE;
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

// ─── Tinted pocket card ───────────────────────────────────────────────────────

function PocketCard({
  type,
  icon,
  label,
  amountBase,
  sub,
  aprChip,
  earnedInline,
  suggestion,
}: {
  type: 'spend' | 'save';
  icon: string;
  label: string;
  amountBase: number;
  sub?: string;
  aprChip?: string;
  earnedInline?: string;
  /** Non-shifting hint: the agent has a pending suggestion for this pocket. */
  suggestion?: boolean;
}) {
  const isSpend = type === 'spend';
  return (
    <div style={{
      borderRadius: '0.875rem',
      padding: '1rem 1.125rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
      background: isSpend ? 'rgba(245,158,11,0.08)' : 'var(--color-savings-dim)',
      border: `1px solid ${isSpend ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.22)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
          {icon} {label}
          {suggestion && (
            <span style={{
              marginLeft: '0.4rem', textTransform: 'none', letterSpacing: 0, fontWeight: 600,
              fontSize: '0.6rem', color: 'var(--color-savings)',
              background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.22)',
              borderRadius: '999px', padding: '0.05rem 0.4rem', verticalAlign: 'middle',
            }}>
              suggestion ↓
            </span>
          )}
        </span>
        {aprChip && (
          <span style={{
            fontSize: '0.625rem', fontWeight: 700,
            color: 'var(--color-savings)', background: 'rgba(16,185,129,0.12)',
            border: '1px solid rgba(16,185,129,0.25)',
            borderRadius: '999px', padding: '0.0625rem 0.375rem',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>{aprChip}</span>
        )}
        {sub && !aprChip && (
          <span style={{ fontSize: '0.72rem', color: 'var(--color-muted-2)', whiteSpace: 'nowrap' }}>{sub}</span>
        )}
      </div>
      <div>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700,
          letterSpacing: '-0.02em', whiteSpace: 'nowrap',
          color: isSpend ? 'var(--color-liquid)' : 'var(--color-savings-bright)',
        }}>
          ${formatMoney(amountBase)}
        </span>
        <span style={{ fontSize: '0.8rem', fontWeight: 400, color: 'var(--color-muted-2)', marginLeft: '0.3rem' }}>
          {COIN_SYM}
        </span>
        {earnedInline && (
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-savings)', marginLeft: '0.4rem', fontFamily: 'var(--font-mono)' }}>
            ({earnedInline})
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function DashSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ padding: '0.5rem 0 0.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div className="skeleton" style={{ width: '60px', height: '0.8rem' }} />
        <div className="skeleton" style={{ width: '200px', height: '2.6rem' }} />
      </div>
      <div className="skeleton" style={{ width: '100%', height: '4.5rem', borderRadius: '0.875rem' }} />
      <div className="skeleton" style={{ width: '100%', height: '4.5rem', borderRadius: '0.875rem' }} />
    </div>
  );
}

export function LiveDashboard() {
  const { balances, earnings, isStale, proposals, settings, walletBalance, autopilot } = useVaultData();
  const autopilotActive = autopilot.enabled && !autopilot.suspended;
  // Autopilot acts instead of suggesting — no "suggestion" chips while it's on.
  const hints = autopilotActive ? { spend: false, save: false } : pendingSuggestionPockets(proposals, settings.band);

  // Debounce the "get started" empty state: a single zero read mid-drain
  // (position destroyed, liquid not yet refreshed) must not flash onboarding.
  // Require the PREVIOUS read to also be fully-zero before showing it.
  const walletBase = Number(walletBalance ?? '0');
  const bothZeroNow = !!balances && Number(balances.liquid) + Number(balances.savingsValue) === 0 && walletBase === 0;
  const prevBothZero = useRef(false);
  useEffect(() => { prevBothZero.current = bothZeroNow; }, [bothZeroNow]);

  // No data yet (fresh session, first poll pending): skeletons — never a
  // zeroed dashboard or a premature "add money" empty state.
  if (!balances) return <DashSkeleton />;

  // Flooring both pockets guarantees Spend + Save === Total on screen.
  const liquid = floorCents(Number(balances?.liquid ?? 0));
  const savingsValue = floorCents(Number(balances?.savingsValue ?? 0));
  const total = liquid + savingsValue;

  const accrued = earnings ? Math.max(0, Number(earnings.accrued)) : 0;
  const aprBps = earnings ? Number(earnings.aprBps) : 0;
  const aprLabel = aprBps > 0 ? `earning ${(aprBps / 100).toFixed(1)}% APR` : undefined;
  const earnedInline = accrued > 0 ? `+$${floorToDecimals(accrued, 4)}` : undefined;

  const vaultEmpty = Number(balances.liquid) + Number(balances.savingsValue) === 0;
  const arrived = vaultEmpty && walletBase > 0;
  // Show onboarding only when the vault AND wallet are zero on TWO consecutive
  // reads; a single mid-drain zero falls through to the (truthful) $0 dashboard.
  const showGetStarted = vaultEmpty && walletBase === 0 && prevBothZero.current;

  if (arrived || showGetStarted) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2.5rem 1rem', textAlign: 'center' }}>
        <div style={{ fontSize: '2rem' }}>{arrived ? '✅' : '💸'}</div>
        <div style={{ color: 'var(--color-text)', fontWeight: 600, fontSize: '1rem' }}>
          {arrived ? `$${formatMoney(walletBase)} is in your wallet` : 'Add money to get started'}
        </div>
        <div style={{ color: 'var(--color-muted)', fontSize: '0.85rem', lineHeight: 1.6, maxWidth: '22rem' }}>
          {arrived
            ? 'Add it to CashPan to start spending and earning.'
            : 'Debit card, bank, or Apple Pay — or receive crypto to your address. Arrives in minutes.'}
        </div>
        <button
          onClick={() => dispatch('cashpan:show-receive')}
          style={{ background: 'var(--color-savings)', color: '#0a0f1e', border: 'none', borderRadius: '0.625rem', padding: '0.75rem 1.5rem', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', minHeight: '44px' }}
        >
          {arrived ? 'Add to CashPan →' : 'Add money →'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Total — lead number */}
      <div style={{ padding: '0.5rem 0 0.25rem' }}>
        <div style={{ color: 'var(--color-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.09em', fontWeight: 600, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          Total
          {isStale && (
            <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, animation: 'skeleton-pulse 1.4s ease-in-out infinite' }}>
              updating…
            </span>
          )}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2.5rem', fontWeight: 700, color: 'var(--color-text)', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
          ${formatMoney(total)} <span style={{ fontSize: '1.1rem', color: 'var(--color-muted)', fontWeight: 400 }}>{COIN_SYM}</span>
        </div>
      </div>

      {/* Autopilot state — the worker is acting on these pockets */}
      {autopilot.enabled && !autopilot.suspended && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.68rem', color: 'var(--color-savings)' }}>
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--color-savings)', display: 'inline-block' }} />
          Autopilot on
        </div>
      )}
      {autopilot.suspended && (
        <div style={{ fontSize: '0.72rem', color: 'rgba(251,191,36,0.9)', lineHeight: 1.5 }}>
          ⚠ Autopilot paused — needs attention. Turn it on again in Profile.
        </div>
      )}

      {/* Pocket cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <PocketCard type="spend" icon="💵" label="Spend" amountBase={liquid} sub="ready to use" suggestion={hints.spend} />
        <PocketCard type="save" icon="💰" label="Save" amountBase={savingsValue} aprChip={aprLabel} earnedInline={earnedInline} suggestion={hints.save} />
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <QuickBtn icon="📥" label="Receive" onClick={() => dispatch('cashpan:show-receive')} />
        <QuickBtn icon="↗" label="Send" onClick={() => dispatch('cashpan:show-send')} />
        <QuickBtn icon="⇄" label="Move" onClick={() => dispatch('cashpan:show-move')} />
      </div>

    </div>
  );
}
