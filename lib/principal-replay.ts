/**
 * Shared principal replay function — single implementation used by both the
 * watcher reconcile phase and scripts/reconcile-principal.ts. No drift possible.
 *
 * TOPUP uses simplified raw subtraction because historical savings values are
 * unavailable without an archive node. Gives a conservative lower bound on
 * principal; acceptable since the watcher overwrites with the correct value
 * on each run anyway.
 */

export interface PrincipalResult {
  principal: bigint;
  sweeps: number;
  topups: number;
}

interface ReplayEvent {
  contents?: { json?: Record<string, unknown> | null } | null;
}

const SWEEP = 0;
const TOPUP = 1;

/**
 * Replay events in chronological order (oldest-first as returned by GraphQL).
 * Start from zero — never seed from stored state.
 */
export function replayPrincipal(events: ReplayEvent[]): PrincipalResult {
  let principal = 0n;
  let sweeps = 0;
  let topups = 0;

  for (const ev of events) {
    const json = ev.contents?.json;
    if (!json) continue;
    const direction = Number(json.direction ?? -1);
    const amount = BigInt(String(json.amount ?? '0'));
    if (amount === 0n) continue;

    if (direction === SWEEP) {
      principal += amount;
      sweeps++;
    } else if (direction === TOPUP) {
      principal = principal > amount ? principal - amount : 0n;
      topups++;
    }
  }

  return { principal, sweeps, topups };
}
