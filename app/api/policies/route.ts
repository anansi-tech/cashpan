/**
 * Standing orders (scheduled-send policies) — session-authed CRUD.
 *
 * Everything is scoped to the authenticated session's own vault (resolveVault
 * → vaultId); client-supplied vault ids are never read. Activation stores
 * OWNER INTENT only — the chain allowlist + outflow caps are the security
 * boundary, and the worker cannot send anywhere the owner didn't sign for.
 *
 * POST re-validates through the same proposeRecurringSend pipeline the chat
 * tool uses (amount vs live per-tx cap, schedule shape, contact resolution) —
 * one pipeline, two doors, and the API door cannot skip the checks.
 */

import { NextResponse } from 'next/server';
import { resolveVault } from '@/lib/resolve-vault';
import { proposeRecurringSend } from '@/lib/propose';
import { buildContactMap } from '@/lib/propose';
import { nextRun, scheduleSentence, type PolicySchedule } from '@/lib/policy-schedule';
import {
  createPolicy, listPolicies, setPolicyStatus, deletePolicy,
  listUnacknowledgedFailures, acknowledgeRun,
} from '@/lib/db/policies';
import { suiNetwork } from '@/lib/sui';
import { baseToHuman } from '@/lib/coin-config';

export const dynamic = 'force-dynamic';

function policyView(p: Awaited<ReturnType<typeof listPolicies>>[number]) {
  const schedule = p.schedule as PolicySchedule;
  return {
    id: p._id,
    recipient: p.recipient,
    amountSui: baseToHuman(BigInt(p.amountBase), 6),
    amountBase: p.amountBase,
    schedule,
    scheduleText: scheduleSentence(schedule),
    status: p.status,
    nextRunISO: p.status === 'active' ? nextRun(schedule, new Date())?.toISOString() ?? null : null,
    note: p.note,
  };
}

export async function GET(req: Request) {
  const vault = await resolveVault(req).catch(() => null);
  if (!vault) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const [policies, failures] = await Promise.all([
    listPolicies(vault.vaultId, suiNetwork()),
    listUnacknowledgedFailures(vault.vaultId),
  ]);
  return NextResponse.json({
    policies: policies.map(policyView),
    failures: failures.map((f) => ({
      runId: f._id,
      policyId: f.policyId,
      period: f.period,
      amountSui: baseToHuman(BigInt(f.amountBase), 6),
      error: f.error,
      at: f.lastAttemptAt,
    })),
  });
}

export async function POST(req: Request) {
  const vault = await resolveVault(req).catch(() => null);
  if (!vault) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    amountSui?: string;
    payeeLabel?: string;
    schedule?: PolicySchedule;
    note?: string;
    /** true → validate and return the proposal WITHOUT persisting (form door). */
    preview?: boolean;
  };
  if (!body.amountSui || !body.payeeLabel || !body.schedule) {
    return NextResponse.json({ error: 'amountSui, payeeLabel and schedule are required' }, { status: 400 });
  }

  // Same pipeline as the chat door — resolves the contact, validates the
  // schedule, and blocks amounts above the live on-chain per-tx cap.
  const contactMap = buildContactMap(vault.contacts ?? []);
  const network = suiNetwork();
  const active = await listPolicies(vault.vaultId, network);
  const activeTotal = active.filter((p) => p.status === 'active')
    .reduce((sum, p) => sum + BigInt(p.amountBase), 0n);
  const proposal = await proposeRecurringSend(
    body.amountSui, body.payeeLabel, body.schedule, vault.vaultId, contactMap,
    { activePolicyTotalBase: activeTotal, autopilotOn: !!vault.autopilot?.enabled },
  );
  // Preview (form door): the SendSheet renders the same PolicyCard the chat
  // door gets, blocked or not — same pipeline, same card.
  if (body.preview) return NextResponse.json({ proposal });

  if (proposal.blocked) {
    return NextResponse.json({ error: proposal.blockedDetail ?? proposal.blocked, blocked: proposal.blocked }, { status: 400 });
  }

  const policy = await createPolicy({
    vaultId: vault.vaultId,
    network,
    recipient: { address: proposal.recipient!, label: proposal.payeeLabel },
    amountBase: proposal.amountBase,
    schedule: body.schedule,
    note: body.note,
  });
  return NextResponse.json({ ok: true, policy: policyView(policy) });
}

export async function PATCH(req: Request) {
  const vault = await resolveVault(req).catch(() => null);
  if (!vault) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    id?: string;
    status?: 'active' | 'paused';
    acknowledgeRunId?: string;
  };

  // Failure-card acknowledge (B5) — scoped to this vault's own runs.
  if (body.acknowledgeRunId) {
    const ok = await acknowledgeRun(body.acknowledgeRunId, vault.vaultId);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  if (!body.id || (body.status !== 'active' && body.status !== 'paused')) {
    return NextResponse.json({ error: 'id and status (active|paused) required' }, { status: 400 });
  }
  const ok = await setPolicyStatus(body.id, vault.vaultId, body.status);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Policy not found' }, { status: 404 });
}

export async function DELETE(req: Request) {
  const vault = await resolveVault(req).catch(() => null);
  if (!vault) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const ok = await deletePolicy(id, vault.vaultId);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Policy not found' }, { status: 404 });
}
