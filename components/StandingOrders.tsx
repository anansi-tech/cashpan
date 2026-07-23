'use client';

/**
 * Standing orders list — sentences + next run, per-policy Pause / Delete.
 * Session-authed intent management: pausing stops the worker from executing;
 * the chain's allowlist + outflow caps stay the security boundary regardless.
 */

import { useCallback, useEffect, useState } from 'react';
import { formatMoneyHuman } from '@/lib/format';

interface PolicyView {
  id: string;
  recipient: { address: string; label: string };
  amountSui: string;
  scheduleText: string;
  status: 'active' | 'paused' | 'ended' | 'failed';
  nextRunISO: string | null;
}

const STATUS_COPY: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'var(--color-savings)' },
  paused: { label: 'Paused', color: 'var(--color-muted)' },
  failed: { label: 'Needs attention', color: 'rgba(251,191,36,0.9)' },
};

export function StandingOrders({ compact }: { compact?: boolean }) {
  const [policies, setPolicies] = useState<PolicyView[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/policies');
      if (res.ok) setPolicies(((await res.json()) as { policies: PolicyView[] }).policies);
    } catch { /* leave previous */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = async (id: string, status: 'active' | 'paused') => {
    setBusyId(id);
    try {
      await fetch('/api/policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      await load();
    } finally { setBusyId(null); }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await fetch('/api/policies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await load();
    } finally { setBusyId(null); }
  };

  // Hide the section entirely until the user has at least one standing order.
  if (!policies || policies.length === 0) return null;

  const pad = compact ? '0.75rem 1rem' : '1rem 0';
  const smallBtn = (danger?: boolean): React.CSSProperties => ({
    background: 'none', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600,
    border: `1px solid ${danger ? 'rgba(239,68,68,0.3)' : 'var(--color-border)'}`,
    color: danger ? 'rgba(252,165,165,0.9)' : 'var(--color-muted)',
    borderRadius: '0.4rem', padding: '0.2rem 0.5rem', minHeight: '28px',
  });

  return (
    <div style={{ padding: pad, borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
        Standing orders
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {policies.map((p) => {
          const status = STATUS_COPY[p.status] ?? STATUS_COPY.paused;
          const busy = busyId === p.id;
          return (
            <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text)', lineHeight: 1.45 }}>
                {p.scheduleText}, send ${formatMoneyHuman(p.amountSui)} to {p.recipient.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.68rem', fontWeight: 600, color: status.color }}>{status.label}</span>
                {p.status === 'active' && p.nextRunISO && (
                  <span style={{ fontSize: '0.68rem', color: 'var(--color-muted)' }}>
                    next {new Date(p.nextRunISO).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                {(p.status === 'active' || p.status === 'paused' || p.status === 'failed') && (
                  <button
                    disabled={busy}
                    onClick={() => patch(p.id, p.status === 'active' ? 'paused' : 'active')}
                    style={{ ...smallBtn(), opacity: busy ? 0.5 : 1 }}
                  >
                    {p.status === 'active' ? 'Pause' : 'Resume'}
                  </button>
                )}
                <button disabled={busy} onClick={() => remove(p.id)} style={{ ...smallBtn(true), opacity: busy ? 0.5 : 1 }}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
