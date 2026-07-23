/**
 * Autopilot enable/disable — records OWNER INTENT after the owner has signed
 * the on-chain capability change (issue_agent_cap / revoke).
 *
 * The chain is the authority: enabling mints an AgentCap at the current nonce;
 * disabling bumps the nonce and kills every outstanding cap instantly. This
 * route only persists intent + the cap id so the worker knows which vaults to
 * drive. Everything is keyed to the authenticated session's own vault.
 *
 * GET returns the agent address the client must mint the cap to (public key
 * material only — AGENT_SECRET_KEY lives ONLY in the worker env).
 */

import { NextResponse } from 'next/server';
import { getAuthedSub } from '@/lib/session';
import { getActiveVault, setAutopilot } from '@/lib/db/vault-registry';
import { suiNetwork } from '@/lib/sui';
import { humanToBase } from '@/lib/coin-config';

export const dynamic = 'force-dynamic';

const AGENT_ADDRESS = process.env.AGENT_ADDRESS ?? '';

export async function GET(req: Request) {
  const sub = getAuthedSub(req);
  if (!sub) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const vault = await getActiveVault(sub, suiNetwork());
  if (!vault) return NextResponse.json({ error: 'Vault not found' }, { status: 404 });

  return NextResponse.json({
    agentAddress: AGENT_ADDRESS || null,
    configured: !!AGENT_ADDRESS,
    autopilot: vault.autopilot ?? { enabled: false },
  });
}

export async function POST(req: Request) {
  const sub = getAuthedSub(req);
  if (!sub) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const vault = await getActiveVault(sub, suiNetwork());
  if (!vault) return NextResponse.json({ error: 'Vault not found' }, { status: 404 });

  const { enabled, agentCapId, dailyLimit } = await req.json().catch(() => ({})) as {
    enabled?: boolean; agentCapId?: string; dailyLimit?: string;
  };

  if (enabled) {
    if (!AGENT_ADDRESS) return NextResponse.json({ error: 'Autopilot not configured' }, { status: 503 });
    if (!agentCapId || !/^0x[0-9a-fA-F]{64}$/.test(agentCapId)) {
      return NextResponse.json({ error: 'Valid agentCapId required' }, { status: 400 });
    }
    let dailyCapBase: string | undefined;
    if (dailyLimit !== undefined) {
      const n = parseFloat(dailyLimit);
      if (!isFinite(n) || n <= 0) return NextResponse.json({ error: 'Invalid daily limit' }, { status: 400 });
      dailyCapBase = humanToBase(dailyLimit).toString();
    }
    // Re-enabling always clears a prior suspension.
    await setAutopilot(sub, { enabled: true, agentCapId, dailyCapBase, enabledAt: new Date(), suspended: false });
    return NextResponse.json({ ok: true, enabled: true });
  }

  // Disable: the owner has already signed revoke() on-chain — the cap is dead
  // regardless of what we store; this just stops the worker from trying.
  await setAutopilot(sub, { enabled: false, suspended: false });
  return NextResponse.json({ ok: true, enabled: false });
}
