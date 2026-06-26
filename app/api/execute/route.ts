/**
 * /api/execute — the ONLY endpoint that signs and submits transactions.
 *
 * NOT registered as an LLM tool. The model cannot call it.
 * Only reachable by explicit user action (tapping Confirm on a ConfirmCard).
 *
 * Security: re-validates the proposal from fresh on-chain reads before signing.
 * Signs with the agent key only — owner key never touches this server.
 */

import { NextResponse } from 'next/server';
import { executeProposal } from '@/lib/execute';
import { resolveVault } from '@/lib/resolve-vault';
import type { Proposal } from '@/lib/propose';

export async function POST(req: Request) {
  let proposal: Proposal;
  try {
    proposal = await req.json() as Proposal;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!proposal.action || !proposal.amountMist) {
    return NextResponse.json({ error: 'Missing required proposal fields' }, { status: 400 });
  }

  if (proposal.blocked) {
    return NextResponse.json({ error: `Proposal is blocked: ${proposal.blocked}` }, { status: 400 });
  }

  try {
    const vault = await resolveVault(req);
    const result = await executeProposal(proposal, { vaultId: vault.vaultId, agentCapId: vault.agentCapId });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Execution failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
