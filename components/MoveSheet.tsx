'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useVaultData } from './VaultDataProvider';
import { ConfirmCard } from './ConfirmCard';
import type { Proposal } from '@/lib/propose';
import type { VaultTxContext } from '@/lib/vault-tx';
import { formatMoney } from '@/lib/format';

const MIN_MOVE = 0.01;

/**
 * Manual Move — deterministic pocket transfers without the agent.
 * The form is a front door to the SAME pipeline chat uses: it fetches a
 * Proposal from /api/propose and renders the shared ConfirmCard → sign path.
 */
export function MoveSheet({ vaultCtx, onClose }: { vaultCtx: VaultTxContext; onClose: () => void }) {
  const { balances, refresh } = useVaultData();
  const liquid = BigInt(balances?.liquid ?? '0');
  const savings = BigInt(balances?.savingsValue ?? '0');

  // Default direction: source with the larger balance.
  const [direction, setDirection] = useState<'sweep' | 'topup'>(liquid >= savings ? 'sweep' : 'topup');
  const [amount, setAmount] = useState('');
  const [max, setMax] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [state, setState] = useState<'form' | 'loading'>('form');
  const [error, setError] = useState('');

  const sourceBase = direction === 'sweep' ? liquid : savings;
  const sourceLabel = direction === 'sweep' ? 'Spend' : 'Save';

  const amountNum = parseFloat(amount);
  const amountValid = max || (isFinite(amountNum) && amountNum > 0);
  const belowDust = !max && amountValid && amountNum < MIN_MOVE;
  const overSource = !max && amountValid && BigInt(Math.round(amountNum * 1e6)) > sourceBase;
  const canSubmit = amountValid && !belowDust && !overSource && state === 'form';

  const pickMax = () => {
    setMax(true);
    setAmount(formatMoney(sourceBase).replace(/,/g, ''));
  };

  const typeAmount = (v: string) => {
    setMax(false);
    setAmount(v);
  };

  const submit = async () => {
    setState('loading');
    setError('');
    try {
      const res = await fetch('/api/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: direction, ...(max ? { max: true } : { amount }) }),
      });
      const data = await res.json().catch(() => ({})) as { proposal?: Proposal; error?: string };
      if (!res.ok || !data.proposal) throw new Error(data.error ?? 'Could not prepare the move');
      setProposal(data.proposal);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setState('form');
    }
  };

  // ── Confirm step: the SAME card chat renders ───────────────────────────────
  if (proposal) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '1.25rem', gap: '1rem' }}>
        <ConfirmCard
          proposal={proposal}
          vaultCtx={vaultCtx}
          onDismiss={() => setProposal(null)}
          onSuccess={() => { refresh(); setTimeout(onClose, 1600); }}
        />
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '1.25rem', gap: '1.25rem' }}>

      {/* Direction toggle */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <DirectionBtn active={direction === 'sweep'} onClick={() => { setDirection('sweep'); setMax(false); setAmount(''); }}>
          💵 Spend → Save 💰
        </DirectionBtn>
        <DirectionBtn active={direction === 'topup'} onClick={() => { setDirection('topup'); setMax(false); setAmount(''); }}>
          💰 Save → Spend 💵
        </DirectionBtn>
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>
        {sourceLabel} has ${formatMoney(sourceBase)} available.
      </div>

      {/* Amount */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.25rem', flex: 1,
          background: 'rgba(255,255,255,0.04)', border: `1px solid ${overSource || belowDust ? 'rgba(239,68,68,0.4)' : 'var(--color-border)'}`,
          borderRadius: '0.625rem', padding: '0 0.75rem',
        }}>
          <span style={{ color: 'var(--color-muted)', fontSize: '0.9rem' }}>$</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => typeAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void submit(); }}
            autoFocus
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--color-text)', fontSize: '1.05rem', fontFamily: 'var(--font-mono)',
              padding: '0.75rem 0', minWidth: 0,
            }}
          />
        </div>
        <button onClick={pickMax} style={{ ...maxBtn, ...(max ? maxBtnActive : {}) }}>Max</button>
      </div>

      {overSource && (
        <div style={inlineError}>Only ${formatMoney(sourceBase)} available in {sourceLabel}.</div>
      )}
      {belowDust && (
        <div style={inlineError}>Minimum move is ${MIN_MOVE.toFixed(2)}.</div>
      )}
      {max && direction === 'topup' && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
          Max moves everything — Save ends at exactly $0.00, interest included.
        </div>
      )}
      {error && <div style={inlineError}>{error}</div>}

      <button
        onClick={submit}
        disabled={!canSubmit}
        style={{
          background: canSubmit ? 'var(--color-savings)' : 'rgba(255,255,255,0.06)',
          color: canSubmit ? '#0a0f1e' : 'var(--color-muted)',
          border: 'none', borderRadius: '0.625rem',
          padding: '0.8rem', fontSize: '0.9375rem', fontWeight: 700,
          cursor: canSubmit ? 'pointer' : 'not-allowed', minHeight: '48px',
        }}
      >
        {state === 'loading' ? 'Preparing…' : 'Review move'}
      </button>
    </div>
  );
}

function DirectionBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '0.7rem 0.5rem', borderRadius: '0.625rem',
        background: active ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? 'rgba(16,185,129,0.35)' : 'var(--color-border)'}`,
        color: active ? 'var(--color-savings-bright)' : 'var(--color-muted)',
        fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', minHeight: '44px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

const maxBtn: CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid var(--color-border)',
  color: 'var(--color-muted)', borderRadius: '0.625rem', padding: '0 0.875rem',
  fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', flexShrink: 0, minHeight: '44px',
};

const maxBtnActive: CSSProperties = {
  background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)',
  color: 'var(--color-savings-bright)',
};

const inlineError: CSSProperties = { fontSize: '0.78rem', color: 'rgba(252,165,165,0.9)' };
