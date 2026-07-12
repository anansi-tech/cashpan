import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getActiveVault } from '@/lib/db/vault-registry';
import { fetchSavingsValue, getAgentActivity } from '@/lib/read-layer';
import { getReplayedPrincipal } from '@/lib/principal-replay';
import { fetchVaultState, getLiveAprBps } from '@/lib/graphql';
import { computeProposals } from '@/lib/brain';
import { suiNetwork } from '@/lib/sui';
import type { Balances } from '@/lib/read-layer';

export const dynamic = 'force-dynamic';

const COIN_TYPE = process.env.COIN_TYPE ?? '';

export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const sub = cookieStore.get('cashpan-sub')?.value;
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const network = suiNetwork();
  const vault = await getActiveVault(sub, network);
  if (!vault) return NextResponse.json({ error: 'Vault not found' }, { status: 404 });

  const settings = { buffer: vault.buffer ?? '50', band: vault.band ?? '5' };
  const contacts = vault.contacts ?? [];
  const addressToName: Record<string, string> = {};
  for (const c of contacts) addressToName[c.address.toLowerCase()] = c.label;
  // Cash-out sends to Coinbase deposit addresses get an honest label —
  // an off-chain label on a real ledger event, never a fabricated event.
  for (const a of vault.offrampAddresses ?? []) addressToName[a.toLowerCase()] = 'Coinbase (cash out)';

  // One GraphQL call (vault + epoch + wallet coins) + one simulateTransaction (savings).
  // Activity, APR, and principal replay run concurrently alongside them.
  const [stateResult, savingsResult, activityResult, aprResult, principalResult] = await Promise.allSettled([
    fetchVaultState(vault.vaultId, vault.payoutAddress, COIN_TYPE),
    fetchSavingsValue(vault.vaultId),
    getAgentActivity(10, vault.vaultId, addressToName),
    getLiveAprBps(COIN_TYPE),
    getReplayedPrincipal(vault.vaultId),
  ]);

  // NEVER serve zeros as truth: if either balance read is still failing after
  // the built-in retries, tell the client to keep showing what it has.
  if (stateResult.status === 'rejected' || savingsResult.status === 'rejected') {
    const reason = stateResult.status === 'rejected' ? stateResult.reason : (savingsResult as PromiseRejectedResult).reason;
    console.error('[state] balance read failed after retries:', reason, { vaultId: vault.vaultId });
    return NextResponse.json({ stale: true }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const gql = stateResult.value;
  const savingsValue = savingsResult.value;
  const activity = activityResult.status === 'fulfilled' ? activityResult.value : [];
  const aprBps = aprResult.status === 'fulfilled' ? aprResult.value : 0;

  const walletBalance = gql.walletBalance;

  const balances: Balances = {
    liquid: gql.liquidBase.toString(),
    savingsValue: savingsValue.toString(),
    total: (gql.liquidBase + savingsValue).toString(),
    currentEpoch: gql.currentEpoch.toString(),
  };

  // Principal is derived on-read from the on-chain event stream (see lib/principal-replay.ts).
  // If the replay fails, report accrued 0 (chip hidden) rather than a wrong number.
  if (principalResult.status === 'rejected') {
    console.error('[state] getReplayedPrincipal failed:', principalResult.reason, { vaultId: vault.vaultId });
  }
  const savingsValueBig = balances ? BigInt(balances.savingsValue) : 0n;
  const principalBig = principalResult.status === 'fulfilled' ? principalResult.value : savingsValueBig;
  const earnings = {
    accrued: (savingsValueBig > principalBig ? savingsValueBig - principalBig : 0n).toString(),
    aprBps: String(aprBps),
  };

  // Belt over force-dynamic: forbid every cache layer (CDN, proxy, browser)
  // from holding this response — a confirmed tx must be visible on the next poll.
  return NextResponse.json({
    balances,
    earnings,
    activity,
    walletBalance,
    proposals: balances ? computeProposals(walletBalance, balances, settings) : [],
    contacts,
    settings,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
