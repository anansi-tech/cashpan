/**
 * Scheduled-send execution pass — Phase B. Deterministic, NO LLM anywhere.
 *
 * Runs after the rebalance pass each tick (natural funding composition: if
 * Spend ran low, autopilot's own topup logic has already had its chance this
 * tick — there is no special "fund the send" path).
 *
 * Exactly-once: every execution goes through the policy_runs ledger
 * (lib/db/policies.ts claimRun / reclaimFailedRun — atomic, unique-indexed).
 * THE STANDING RULE: when uncertain whether money moved, STOP and surface to
 * the owner. Never resend on ambiguity. Crash recovery below verifies against
 * the chain and leaves rows 'executing' while verification itself fails —
 * an unverifiable row is never retried and never resent.
 *
 * Safety comes from the chain: agent_send aborts unless the recipient is on
 * the owner-signed allowlist and the outflow caps allow it. Everything here
 * is gas-saving and bookkeeping, not the security boundary.
 */

import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';

import { periodKey, isDue, type PolicySchedule } from '../lib/policy-schedule.js';
import {
  listActivePolicies, markPolicyRan, markPolicyFailed, getPolicyById,
  getRun, claimRun, reclaimFailedRun, markRunSent, markRunFailed,
  listStaleExecutingRuns,
  type PolicyRecord, type PolicyRunRecord,
} from '../lib/db/policies.js';
import { fetchVaultBasic, fetchVaultJson } from '../lib/graphql.js';
import { buildAgentSendTx } from '../lib/vault-tx.js';
import { baseToHuman } from '../lib/coin-config.js';
import type { VaultRecord } from '../lib/db/vault-registry.js';

const PACKAGE_ID = process.env.PACKAGE_ID ?? '';                     // events (defining id)
const PACKAGE_ID_LATEST = process.env.PACKAGE_ID_LATEST ?? PACKAGE_ID; // moveCall targets
const COIN_TYPE = process.env.COIN_TYPE ?? '';

const STALE_EXECUTING_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
// Retryable failure reasons and their minimum retry spacing. Anything else is
// terminal for the period (and surfaces on the owner's failure card).
const RETRY_SPACING_MS: Record<string, number> = {
  insufficient_funds: 60 * 60_000, // spec: ≥1h apart, same period only
  epoch_cap_wait: 15 * 60_000,     // waiting for the Sui epoch to roll over
  crash_recovered: 15 * 60_000,    // verified-not-sent after a mid-run crash
};

function label(p: PolicyRecord): string {
  return `policy ${p._id.slice(-6)} → ${p.recipient.label}`;
}

// ─── Chain state the caps need ────────────────────────────────────────────────

interface OutflowState {
  liquid: bigint;
  perTxCap: bigint;
  dailyCap: bigint;
  dailySpent: bigint; // already zeroed if the epoch rolled since last reset
}

async function fetchOutflowState(vaultId: string): Promise<OutflowState> {
  const [vf, basic] = await Promise.all([fetchVaultJson(vaultId), fetchVaultBasic(vaultId)]);
  const epochRolled = basic.currentEpoch > BigInt(String(vf.last_reset_epoch ?? '0'));
  return {
    liquid: basic.liquid,
    perTxCap: BigInt(String(vf.outflow_per_tx_cap ?? '0')),
    dailyCap: BigInt(String(vf.outflow_daily_cap ?? '0')),
    dailySpent: epochRolled ? 0n : BigInt(String(vf.outflow_daily_spent ?? '0')),
  };
}

// ─── Execution (protocol step 2+3 — caller has already claimed the run) ───────

async function executeClaimedRun(
  client: SuiJsonRpcClient,
  keypair: Ed25519Keypair,
  runId: string,
  policy: PolicyRecord,
  vault: VaultRecord,
  period: string,
): Promise<void> {
  const amount = BigInt(policy.amountBase);
  const state = await fetchOutflowState(vault.vaultId);

  // Gas-saving pre-checks (the chain re-checks all of these authoritatively).
  if (amount > state.perTxCap) {
    // Cannot ever succeed — creation validates this, so reaching here means the
    // cap changed. Terminal for the period AND for the policy.
    await markRunFailed(runId, 'exceeds_per_tx_cap');
    await markPolicyFailed(policy._id);
    console.error(`[policy] ${label(policy)} exceeds outflow per-tx cap — policy parked`);
    return;
  }
  if (state.dailySpent + amount > state.dailyCap) {
    // Waits for epoch rollover WITHIN the period window (retryable).
    await markRunFailed(runId, 'epoch_cap_wait');
    console.log(`[policy] ${label(policy)} waiting for epoch cap rollover`);
    return;
  }
  if (state.liquid < amount) {
    // The rebalance pass already ran this tick; still short is a real shortfall.
    await markRunFailed(runId, 'insufficient_funds');
    console.log(`[policy] ${label(policy)} insufficient Spend (${state.liquid} < ${amount})`);
    return;
  }

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: buildAgentSendTx(vault.autopilot!.agentCapId!, amount, policy.recipient.address, {
      packageId: PACKAGE_ID_LATEST, coinType: COIN_TYPE, vaultId: vault.vaultId,
    }),
    options: { showEffects: true },
  });

  if (result.effects?.status.status !== 'success') {
    // A Move abort (revoked cap, de-listed recipient, …) won't heal by itself.
    const err = result.effects?.status.error ?? 'agent_send failed';
    await markRunFailed(runId, err);
    await markPolicyFailed(policy._id);
    console.error(`[policy] ${label(policy)} chain abort — policy parked: ${err}`);
    return;
  }

  await markRunSent(runId, result.digest);
  await markPolicyRan(policy._id, period, policy.schedule.kind === 'once');
  console.log(`[policy] sent ${baseToHuman(amount, 6)} to ${policy.recipient.label} (${label(policy)}) digest=${result.digest}`);
}

// ─── Retry decision for an existing failed run (same period only) ─────────────

function retryEligible(run: PolicyRunRecord, now: number): boolean {
  const spacing = RETRY_SPACING_MS[run.error ?? ''];
  if (spacing === undefined) return false; // terminal reason
  if (run.error !== 'epoch_cap_wait' && run.attempts >= MAX_ATTEMPTS) return false;
  return now - new Date(run.lastAttemptAt).getTime() >= spacing;
}

// ─── Crash recovery ───────────────────────────────────────────────────────────

/**
 * 'executing' rows older than 10 min mean a worker died between claim and
 * outcome. Verify AGAINST CHAIN: query this vault's agent SendEvents since the
 * claim; an exact (recipient, amount) match after startedAt = the send
 * happened → mark sent. A SUCCESSFUL query with no match = verified-not-sent →
 * mark failed 'crash_recovered' (retryable). A FAILED query = ambiguity →
 * leave the row 'executing'; it is re-verified next pass and NEVER resent.
 */
async function recoverStaleRuns(client: SuiJsonRpcClient): Promise<void> {
  let stale: PolicyRunRecord[];
  try {
    stale = await listStaleExecutingRuns(STALE_EXECUTING_MS);
  } catch { return; }

  for (const run of stale) {
    const policy = await getPolicyById(run.policyId).catch(() => null);
    if (!policy) continue;
    try {
      const page = await client.queryEvents({
        query: { MoveEventType: `${PACKAGE_ID}::vault::SendEvent` },
        order: 'descending',
        limit: 50,
      });
      const claimedAt = new Date(run.startedAt).getTime() - 2 * 60_000; // clock slack
      const match = page.data.find((ev) => {
        const j = ev.parsedJson as { vault_id?: string; amount?: string; to?: string; by_agent?: boolean };
        return j?.by_agent === true
          && j.vault_id === run.vaultId
          && j.to === policy.recipient.address
          && String(j.amount) === run.amountBase
          && Number(ev.timestampMs ?? 0) >= claimedAt;
      });
      if (match) {
        await markRunSent(run._id, match.id.txDigest);
        await markPolicyRan(policy._id, run.period, policy.schedule.kind === 'once');
        console.log(`[policy] recovered ${label(policy)} — send WAS on chain (${match.id.txDigest})`);
      } else {
        await markRunFailed(run._id, 'crash_recovered');
        console.log(`[policy] recovered ${label(policy)} — verified not sent; eligible for retry`);
      }
    } catch (err) {
      // Ambiguity: cannot verify → do NOTHING. Never resend on ambiguity.
      console.error(`[policy] could not verify stale run ${run._id} — leaving for next pass:`, err instanceof Error ? err.message : err);
    }
  }
}

// ─── Tick entry point ─────────────────────────────────────────────────────────

export async function runPolicyPass(
  client: SuiJsonRpcClient,
  keypair: Ed25519Keypair,
  vaults: VaultRecord[],
  network: string,
): Promise<void> {
  await recoverStaleRuns(client);

  const byVaultId = new Map(vaults.map((v) => [v.vaultId, v]));
  let policies: PolicyRecord[];
  try {
    policies = await listActivePolicies([...byVaultId.keys()], network);
  } catch (err) {
    console.error('[policy] could not load policies:', err instanceof Error ? err.message : err);
    return;
  }

  const now = new Date();
  for (const policy of policies) {
    const vault = byVaultId.get(policy.vaultId);
    if (!vault?.autopilot?.agentCapId) continue; // autopilot off/suspended pauses its policies

    try {
      if (policy.endAt && now > new Date(policy.endAt)) {
        await markPolicyRan(policy._id, policy.lastRunPeriod ?? '', true); // ended
        continue;
      }
      const schedule = policy.schedule as PolicySchedule;
      if (!isDue(schedule, now)) continue;

      const period = periodKey(schedule, now);
      if (policy.lastRunPeriod === period) continue; // fast path: already sent this period

      // ── Exactly-once protocol ──
      const existing = await getRun(policy._id, period);
      let runId: string | null = null;
      if (existing === null) {
        runId = await claimRun(policy._id, period, vault.vaultId, policy.amountBase);
      } else if (existing.status === 'failed' && retryEligible(existing, now.getTime())) {
        runId = (await reclaimFailedRun(existing._id)) ? existing._id : null;
      }
      // 'sent', 'executing', ineligible retry, or lost claim race → skip.
      if (runId === null) continue;

      await executeClaimedRun(client, keypair, runId, policy, vault, period);
    } catch (err) {
      console.error(`[policy] ${label(policy)} pass error:`, err instanceof Error ? err.message : err);
    }
  }
}
