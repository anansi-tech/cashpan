'use client';

/**
 * Standing-order confirmation card — both authoring doors land here (the chat
 * proposeRecurringSend tool and the Send sheet's "Make it repeating" form).
 *
 * The LLM only AUTHORED the proposal; nothing executes until the owner taps
 * Confirm, and the taps are owner-signed transactions. The flow shows every
 * step honestly:
 *   ① Turn on Autopilot (sign)            — only if no AgentCap exists yet
 *   ② Approve <payee> as a recipient (sign) — only if not on the allowlist
 *   ③ Standing order active
 * Even with bugs above, the chain refuses agent_send to any address the owner
 * never signed onto the allowlist.
 */

import { useState } from 'react';
import type { RecurringSendProposal } from '@/lib/propose';
import type { VaultTxContext } from '@/lib/vault-tx';
import { buildAddPayeeTx, buildIssueAgentCapTx } from '@/lib/vault-tx';
import { executeTransaction } from '@/lib/execute-zklogin';
import { formatMoneyHuman } from '@/lib/format';
import { StepCard, StepList, stepGhostBtn, stepPrimaryBtn, type Step } from './TransferProgress';
import { useVaultData } from './VaultDataProvider';

const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'USD';
const ACCENT = 'var(--color-savings)';

type Phase = 'review' | 'autopilot' | 'allowlist' | 'activating' | 'done' | 'error';

interface PolicyCardProps {
  proposal: RecurringSendProposal;
  vaultCtx: VaultTxContext;
  onDismiss?: () => void;
  onDone?: () => void;
}

const BLOCKED_COPY: Record<string, (p: RecurringSendProposal) => string> = {
  not_a_payee: (p) => `I don't know "${p.payeeLabel}" yet — add them in Contacts first, then set up the standing order.`,
  exceeds_per_tx_cap: (p) => `Each automatic send is limited to $${formatMoneyHuman(p.perTxCapSui ?? '0')} — try that or less.`,
  invalid_schedule: (p) => p.blockedDetail ?? 'That schedule doesn\'t look right.',
  insufficient_liquid: () => 'Not enough in Spend right now.',
  no_savings: () => 'Nothing in Save right now.',
  keep_exceeds_savings: () => 'That keeps more than Save holds.',
};

export function PolicyCard({ proposal, vaultCtx, onDismiss, onDone }: PolicyCardProps) {
  const { refresh } = useVaultData();
  const [phase, setPhase] = useState<Phase>('review');
  const [error, setError] = useState('');
  // Steps that already succeeded — "Try again" resumes, never re-signs a done
  // step (re-running ① would mint a second AgentCap for nothing).
  const [completed, setCompleted] = useState<{ autopilot?: boolean; allowlist?: boolean }>({});

  const sentence = `${proposal.scheduleText}, send $${formatMoneyHuman(proposal.amountSui)} to ${proposal.payeeLabel}`;
  const nextRunLocal = proposal.nextRunISO
    ? new Date(proposal.nextRunISO).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  if (proposal.blocked) {
    const copy = BLOCKED_COPY[proposal.blocked]?.(proposal) ?? 'This standing order can\'t be set up right now.';
    return (
      <StepCard accent="rgba(251,191,36,0.8)">
        <div style={{ fontSize: '0.85rem', color: 'var(--color-text)', lineHeight: 1.55 }}>{copy}</div>
      </StepCard>
    );
  }

  // The signing steps this particular confirm needs, in order.
  const steps: Array<{ key: 'autopilot' | 'allowlist'; label: string }> = [
    ...(proposal.needsAutopilot ? [{ key: 'autopilot' as const, label: 'Turn on Autopilot (sign)' }] : []),
    ...(proposal.needsAllowlist ? [{ key: 'allowlist' as const, label: `Approve ${proposal.payeeLabel} as a recipient (sign)` }] : []),
  ];

  const stepList: Step[] = [
    ...steps.map((s) => ({
      label: s.label,
      state: (phase === s.key ? 'active' : completed[s.key] || phase === 'done' || phase === 'activating' ? 'done' : 'pending') as Step['state'],
    })),
    { label: 'Standing order active', state: phase === 'done' ? 'done' : phase === 'activating' ? 'active' : 'pending' },
  ];

  const confirm = async () => {
    setError('');
    try {
      if (proposal.needsAutopilot && !completed.autopilot) {
        setPhase('autopilot');
        const res = await fetch('/api/autopilot');
        const { agentAddress } = await res.json() as { agentAddress?: string | null };
        if (!agentAddress) throw new Error('Autopilot isn\'t available right now');
        const result = await executeTransaction(buildIssueAgentCapTx(agentAddress, vaultCtx));
        const types = result.objectTypes ?? {};
        const agentCapId = Object.keys(types).find((id) => types[id].includes('::vault::AgentCap'));
        if (!agentCapId) throw new Error('Could not find the new AgentCap — try again');
        const on = await fetch('/api/autopilot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true, agentCapId, dailyLimit: '100' }),
        });
        if (!on.ok) throw new Error(((await on.json()) as { error?: string }).error ?? 'Could not turn on Autopilot');
        setCompleted((c) => ({ ...c, autopilot: true }));
      }

      if (proposal.needsAllowlist && !completed.allowlist) {
        setPhase('allowlist');
        await executeTransaction(buildAddPayeeTx(proposal.recipient!, vaultCtx));
        setCompleted((c) => ({ ...c, allowlist: true }));
      }

      setPhase('activating');
      const res = await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountSui: proposal.amountSui, payeeLabel: proposal.payeeLabel, schedule: proposal.schedule }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Could not activate');

      setPhase('done');
      refresh();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setPhase('error');
    }
  };

  const busy = phase === 'autopilot' || phase === 'allowlist' || phase === 'activating';

  return (
    <StepCard accent={ACCENT}>
      <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Standing order
      </div>

      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.5 }}>
        {sentence}
      </div>

      {nextRunLocal && phase !== 'done' && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
          First send: {nextRunLocal} · no end date · {COIN_SYM}
        </div>
      )}

      {proposal.capWarning && phase === 'review' && (
        <div style={{ fontSize: '0.75rem', color: 'rgba(251,191,36,0.9)', lineHeight: 1.5 }}>
          {proposal.capWarning}
        </div>
      )}

      {/* Multi-step flows show their steps honestly; single-step stays terse */}
      {(steps.length > 0 || busy || phase === 'done') && <StepList steps={stepList} />}

      {phase === 'done' ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--color-savings)', fontWeight: 600 }}>
          ✓ Active — see Standing orders in your profile to pause or delete it.
        </div>
      ) : (
        <>
          {error && <div style={{ fontSize: '0.75rem', color: 'rgba(252,165,165,0.9)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={confirm} disabled={busy} style={{ ...stepPrimaryBtn, opacity: busy ? 0.6 : 1, flex: 1 }}>
              {busy ? 'Setting up…' : phase === 'error' ? 'Try again' : 'Confirm'}
            </button>
            {onDismiss && !busy && (
              <button onClick={onDismiss} style={stepGhostBtn}>Cancel</button>
            )}
          </div>
        </>
      )}
    </StepCard>
  );
}
