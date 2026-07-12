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

// ─── Derived on-read principal with layered checkpoint cache ──────────────────
//
// Per-vault cursor + folded state, layered:
//   memory (globalThis, warm instances) → Mongo replay_checkpoints (cold
//   instances) → full genesis replay (cache miss/stale — self-healing).
//
// The Mongo checkpoint is written ONLY here, after a successful fold — one
// pure function caching its own output. Trust rule: a fresh checkpoint is
// trusted as-is (it is our own output); one older than 24h triggers a full
// replay instead, which overwrites it — the periodic verify.

export type PageFetcher = (eventType: string, cursor: string | null) => Promise<PackageEventsPage>;

export interface CheckpointRecord {
  vaultId: string;
  cursor: string | null;
  principal: string;
  eventCount: number;
  updatedAt: Date | string;
}

export interface CheckpointStore {
  load(vaultId: string): Promise<CheckpointRecord | null>;
  save(cp: Omit<CheckpointRecord, 'updatedAt'>): Promise<void>;
}

// Lazy imports keep lib/graphql (@suilend/sdk) and mongoose out of unit tests.
const defaultFetchPage: PageFetcher = async (eventType, cursor) => {
  const { queryPackageEvents } = await import('./graphql');
  return queryPackageEvents(eventType, cursor);
};

const defaultStore: CheckpointStore = {
  load: async (vaultId) => (await import('./db/replay-checkpoint')).getReplayCheckpoint(vaultId),
  save: async (cp) => (await import('./db/replay-checkpoint')).saveReplayCheckpoint(cp),
};

const CHECKPOINT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface VaultEntry {
  cursor: string | null;
  state: PrincipalResult;
  eventCount: number;
}

interface ReplayCache {
  entries: Map<string, VaultEntry>;
  inflight: Map<string, Promise<void>>;
}

const g = globalThis as typeof globalThis & { _principalReplayCache?: ReplayCache };

function cache(): ReplayCache {
  g._principalReplayCache ??= { entries: new Map(), inflight: new Map() };
  return g._principalReplayCache;
}

async function refreshVault(
  vaultId: string,
  rebalanceEventType: string,
  fetchPage: PageFetcher,
  store: CheckpointStore,
): Promise<void> {
  const c = cache();
  const t0 = Date.now();
  let entry = c.entries.get(vaultId);
  let coldSource: 'warm' | 'checkpoint' | 'stale-checkpoint' | 'genesis' = entry ? 'warm' : 'genesis';

  if (!entry) {
    try {
      const cp = await store.load(vaultId);
      if (cp && typeof cp.principal === 'string') {
        const age = Date.now() - new Date(cp.updatedAt).getTime();
        if (age < CHECKPOINT_MAX_AGE_MS) {
          // Fresh checkpoint: trusted as-is — it is this function's own output.
          entry = { cursor: cp.cursor, state: { principal: BigInt(cp.principal), sweeps: 0, topups: 0 }, eventCount: cp.eventCount ?? 0 };
          coldSource = 'checkpoint';
        } else {
          // Periodic verify: replay from genesis instead, then overwrite.
          coldSource = 'stale-checkpoint';
        }
      }
    } catch { /* missing/corrupt/unavailable → genesis replay (self-healing) */ }
    entry ??= { cursor: null, state: ZERO, eventCount: 0 };
    c.entries.set(vaultId, entry);
  }

  let folded = 0;
  let scanned = 0;
  let cursor = entry.cursor;
  let hasMore = true;
  while (hasMore) {
    const { events, nextCursor, endCursor } = await fetchPage(rebalanceEventType, cursor);
    scanned += events.length;
    const mine = events.filter((ev) => String(ev.contents?.json?.vault_id ?? '') === vaultId);
    if (mine.length > 0) {
      entry.state = replayPrincipal(mine, entry.state); // the one fold — never forked
      folded += mine.length;
    }
    // Advance past the last event actually seen; keep old cursor on an empty page.
    if (endCursor) entry.cursor = endCursor;
    cursor = nextCursor;
    hasMore = nextCursor !== null;
  }
  entry.eventCount += folded;

  if (coldSource !== 'warm') {
    const ms = Date.now() - t0;
    console.log(`[principal-replay] cold start (${coldSource}): folded ${folded} events (${scanned} scanned) in ${ms}ms`);
    if (coldSource !== 'checkpoint' && ms > 1000) {
      console.warn(`[principal-replay] full replay took ${ms}ms (>1s) — event volume growing; checkpoint should absorb this on next cold start`);
    }
  }

  // Single writer: snapshot our own output. Non-fatal — the checkpoint is a
  // cache; a failed write just means the next cold start replays more.
  if (folded > 0 || coldSource === 'genesis' || coldSource === 'stale-checkpoint') {
    await store
      .save({ vaultId, cursor: entry.cursor, principal: entry.state.principal.toString(), eventCount: entry.eventCount })
      .catch((e) => console.error('[principal-replay] checkpoint write failed (non-fatal):', e instanceof Error ? e.message : e));
  }
}

/**
 * Current principal for a vault, derived from the on-chain event stream.
 * Throws if the event query fails — callers treat that as "earnings unknown",
 * never as zero.
 */
export async function getReplayedPrincipal(
  vaultId: string,
  fetchPage: PageFetcher = defaultFetchPage,
  store: CheckpointStore = defaultStore,
): Promise<bigint> {
  const packageId = process.env.PACKAGE_ID ?? '';
  if (!packageId) return 0n;

  const c = cache();
  // Serialize per-vault refreshes: concurrent readers await the same pass
  // instead of racing to fold the same events twice.
  let inflight = c.inflight.get(vaultId);
  if (!inflight) {
    inflight = refreshVault(vaultId, `${packageId}::vault::RebalanceEvent`, fetchPage, store)
      .finally(() => { c.inflight.delete(vaultId); });
    c.inflight.set(vaultId, inflight);
  }
  await inflight;

  return c.entries.get(vaultId)?.state.principal ?? 0n;
}
