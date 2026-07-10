/**
 * Savings principal (cost basis), derived on-read from on-chain RebalanceEvents.
 *
 * There is NO stored principal anywhere — the value is a pure fold over the
 * event stream from genesis, so it mathematically cannot desync from chain
 * state. The per-vault checkpoint below is a cache of that fold (cursor +
 * folded state), never a source of truth: losing it just means the next read
 * replays from genesis and rebuilds it.
 *
 * TOPUP uses simplified raw subtraction because historical savings values are
 * unavailable without an archive node. Gives a conservative lower bound on
 * principal (accrued never overstated).
 */

import type { PackageEventsPage } from './graphql';

export interface PrincipalResult {
  principal: bigint;
  sweeps: number;
  topups: number;
}

export interface ReplayEvent {
  contents?: { json?: Record<string, unknown> | null } | null;
}

const SWEEP = 0;
const TOPUP = 1;

const ZERO: PrincipalResult = { principal: 0n, sweeps: 0, topups: 0 };

/**
 * Fold events (oldest-first, as returned by GraphQL) into a principal state.
 * Pass `initial` to resume from a checkpoint — folding events [0..k) and then
 * [k..n) is identical to folding [0..n) in one pass (it's a left fold).
 */
export function replayPrincipal(events: ReplayEvent[], initial: PrincipalResult = ZERO): PrincipalResult {
  let { principal, sweeps, topups } = initial;

  for (const ev of events) {
    const json = ev.contents?.json;
    if (!json) continue;
    const direction = Number(json.direction ?? -1);
    const amount = BigInt(String(json.amount ?? '0'));

    if (amount > 0n) {
      if (direction === SWEEP) {
        principal += amount;
        sweeps++;
      } else if (direction === TOPUP) {
        principal = principal > amount ? principal - amount : 0n;
        topups++;
      }
    }

    // Accounting law, not a patch: the cToken ratio only rises, so a position's
    // value never legitimately falls below its cost basis — basis ≤ value_after
    // is a system invariant. Enforcing it per event makes the fold immune to
    // unemitted drains (pre-upgrade redeem_position emitted nothing): the next
    // event's savings_value_after clamps principal back to reality.
    const rawAfter = json.savings_value_after;
    if (rawAfter !== undefined && rawAfter !== null) {
      const valueAfter = BigInt(String(rawAfter));
      if (principal > valueAfter) principal = valueAfter;
    }
  }

  return { principal, sweeps, topups };
}

// ─── Derived on-read principal with checkpoint cache ──────────────────────────
//
// One cursor over the global RebalanceEvent stream + per-vault folded states.
// Kept on globalThis so warm serverless instances resume incrementally; a cold
// instance replays from genesis (~1-2 GraphQL pages). Concurrent reads share a
// single in-flight refresh so events are never folded into the cache twice.

export type PageFetcher = (eventType: string, cursor: string | null) => Promise<PackageEventsPage>;

// Lazy import keeps lib/graphql (and its @suilend/sdk dependency) out of unit tests.
const defaultFetchPage: PageFetcher = async (eventType, cursor) => {
  const { queryPackageEvents } = await import('./graphql');
  return queryPackageEvents(eventType, cursor);
};

interface ReplayCache {
  cursor: string | null;
  states: Map<string, PrincipalResult>;
  inflight: Promise<void> | null;
}

const g = globalThis as typeof globalThis & { _principalReplayCache?: ReplayCache };

function cache(): ReplayCache {
  g._principalReplayCache ??= { cursor: null, states: new Map(), inflight: null };
  return g._principalReplayCache;
}

async function refresh(rebalanceEventType: string, fetchPage: PageFetcher): Promise<void> {
  const c = cache();
  const coldStart = c.cursor === null;
  const t0 = Date.now();
  let eventCount = 0;
  let cursor = c.cursor;
  let hasMore = true;
  while (hasMore) {
    const { events, nextCursor, endCursor } = await fetchPage(rebalanceEventType, cursor);
    eventCount += events.length;
    for (const ev of events) {
      const vaultId = String(ev.contents?.json?.vault_id ?? '');
      if (!vaultId) continue;
      c.states.set(vaultId, replayPrincipal([ev], c.states.get(vaultId) ?? ZERO));
    }
    // Checkpoint at the last event actually folded; keep old cursor on an empty page.
    if (endCursor) c.cursor = endCursor;
    cursor = nextCursor;
    hasMore = nextCursor !== null;
  }
  if (coldStart) {
    const ms = Date.now() - t0;
    console.log(`[principal-replay] cold-start genesis replay: ${eventCount} events in ${ms}ms`);
    if (ms > 1000) {
      console.warn(`[principal-replay] cold replay took ${ms}ms (>1s) — time to move the checkpoint to Mongo (pure cache, same fold; see module doc)`);
    }
  }
}

/**
 * Current principal for a vault, derived from the on-chain event stream.
 * Throws if the event query fails — callers treat that as "earnings unknown",
 * never as zero.
 */
export async function getReplayedPrincipal(vaultId: string, fetchPage: PageFetcher = defaultFetchPage): Promise<bigint> {
  const packageId = process.env.PACKAGE_ID ?? '';
  if (!packageId) return 0n;

  const c = cache();
  // Serialize refreshes: concurrent readers await the same pass instead of
  // racing to fold the same events twice.
  if (!c.inflight) {
    c.inflight = refresh(`${packageId}::vault::RebalanceEvent`, fetchPage).finally(() => { c.inflight = null; });
  }
  await c.inflight;

  return c.states.get(vaultId)?.principal ?? 0n;
}
