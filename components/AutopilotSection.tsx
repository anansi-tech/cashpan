'use client';

import { useEffect, useState } from 'react';
import type { VaultTxContext } from '@/lib/vault-tx';
import { buildIssueAgentCapTx, buildRevokeAgentTx } from '@/lib/vault-tx';
import { executeTransaction } from '@/lib/execute-zklogin';
import { useVaultData } from './VaultDataProvider';

const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'USD';

interface AutopilotState {
  enabled: boolean;
  suspended?: boolean;
  suspendReason?: string;
  dailyCapBase?: string;
}

/**
 * Autopilot opt-in. Enabling mints an AgentCap (owner-signed) to the service
 * agent; disabling bumps the vault's agent nonce, killing every outstanding
 * cap instantly. Ask-me stays the default — this is opt-in and revocable.
 */
export function AutopilotSection({ vaultCtx, compact }: { vaultCtx: VaultTxContext; compact?: boolean }) {
  const { settings, refresh } = useVaultData();
  const [state, setState] = useState<AutopilotState>({ enabled: false });
  const [agentAddress, setAgentAddress] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [dailyLimit, setDailyLimit] = useState('100');
  const [busy, setBusy] = useState<'on' | 'off' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/autopilot')
      .then((r) => r.json())
      .then((d: { agentAddress?: string | null; configured?: boolean; autopilot?: AutopilotState }) => {
        setAgentAddress(d.agentAddress ?? null);
        setConfigured(d.configured ?? false);
        if (d.autopilot) setState(d.autopilot);
      })
      .catch(() => setConfigured(false));
  }, []);

  const enable = async () => {
    if (!agentAddress) return;
    setBusy('on');
    setError('');
    try {
      const tx = buildIssueAgentCapTx(agentAddress, vaultCtx);
      const result = await executeTransaction(tx) as { objectTypes?: Record<string, string> };
      const types = result.objectTypes ?? {};
      const agentCapId = Object.keys(types).find((id) => types[id].includes('::vault::AgentCap'));
      if (!agentCapId) throw new Error('Could not find the new AgentCap — try again');

      const res = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, agentCapId, dailyLimit }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Could not enable');
      setState({ enabled: true });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn Autopilot on');
    } finally {
      setBusy(null);
    }
  };

  const disable = async () => {
    setBusy('off');
    setError('');
    try {
      // On-chain revoke first — the cap must die even if our bookkeeping fails.
      await executeTransaction(buildRevokeAgentTx(vaultCtx));
      await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      setState({ enabled: false });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn Autopilot off');
    } finally {
      setBusy(null);
    }
  };

  if (!configured) return null; // agent not deployed for this environment

  const pad = compact ? '0.75rem 1rem' : '1rem 0';

  return (
    <div style={{ padding: pad, borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
        <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Autopilot
        </div>
        {state.enabled && !state.suspended && (
          <span style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--color-savings)', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '999px', padding: '0.05rem 0.4rem' }}>
            ON
          </span>
        )}
      </div>

      {state.suspended && (
        <div style={{ fontSize: '0.75rem', color: 'rgba(251,191,36,0.9)', marginBottom: '0.4rem', lineHeight: 1.5 }}>
          ⚠ Autopilot paused — needs attention. {state.suspendReason ? `(${state.suspendReason})` : ''} Turn it on again to resume.
        </div>
      )}

      <div style={{ fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.6, marginBottom: '0.5rem' }}>
        CashPan will automatically move money between your Spend and Save pockets to match your
        rule (keep ${settings.buffer} in Spend), up to ${dailyLimit} {COIN_SYM} per day. You can
        turn this off anytime — it stops instantly.
      </div>

      {!state.enabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>Daily limit $</span>
          <input
            type="text"
            inputMode="decimal"
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            style={{
              width: '4.5rem', background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--color-border)', borderRadius: '0.4rem',
              padding: '0.25rem 0.4rem', color: 'var(--color-text)',
              fontSize: '0.78rem', fontFamily: 'var(--font-mono)', outline: 'none',
            }}
          />
        </div>
      )}

      {error && <div style={{ fontSize: '0.75rem', color: 'rgba(252,165,165,0.9)', marginBottom: '0.4rem' }}>{error}</div>}

      <button
        onClick={state.enabled ? disable : enable}
        disabled={busy !== null}
        style={{
          width: '100%', minHeight: '40px', borderRadius: '0.5rem', cursor: busy ? 'wait' : 'pointer',
          fontSize: '0.82rem', fontWeight: 700,
          background: state.enabled ? 'transparent' : 'var(--color-savings)',
          color: state.enabled ? 'rgba(252,165,165,0.9)' : '#0a0f1e',
          border: state.enabled ? '1px solid rgba(239,68,68,0.3)' : 'none',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy === 'on' ? 'Turning on…' : busy === 'off' ? 'Turning off…'
          : state.enabled ? 'Turn off Autopilot' : 'Turn on Autopilot'}
      </button>
    </div>
  );
}
