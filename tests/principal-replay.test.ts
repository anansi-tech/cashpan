/**
 * Principal is derived on-read: a pure fold over RebalanceEvents, resumable
 * from a checkpoint. These tests pin the two properties that make that safe:
 *
 *  1. Fold equivalence — replaying [0..k) then [k..n) on top of the checkpoint
 *     is identical to one full replay of [0..n), at EVERY split point.
 *  2. The cached reader (getReplayedPrincipal) always equals a fresh full
 *     replay of all events seen so far — across rapid sequential rebalances,
 *     repeated reads, cache loss, and concurrent reads.
 */

import { replayPrincipal, getReplayedPrincipal, type ReplayEvent, type PageFetcher, type CheckpointStore, type CheckpointRecord } from '../lib/principal-replay.js';

const VAULT_A = '0xaaa';
const VAULT_B = '0xbbb';

function ev(vaultId: string, direction: 0 | 1, amount: bigint, valueAfter?: bigint): ReplayEvent {
  return {
    contents: {
      json: {
        vault_id: vaultId,
        direction,
        amount: amount.toString(),
        ...(valueAfter !== undefined ? { savings_value_after: valueAfter.toString() } : {}),
      },
    },
  };
}

function forVault(events: ReplayEvent[], vaultId: string): ReplayEvent[] {
  return events.filter((e) => e.contents?.json?.vault_id === vaultId);
}

/**
 * In-memory event stream standing in for the GraphQL endpoint. Cursors are
 * stringified indices; a read returns everything after the cursor, in pages.
 */
function makeStream(pageSize = 50) {
  const events: ReplayEvent[] = [];
  let calls = 0;
  const fetchPage: PageFetcher = async (_type, cursor) => {
    calls++;
    const start = cursor === null ? 0 : Number(cursor) + 1;
    const page = events.slice(start, start + pageSize);
    const last = start + page.length - 1;
    return {
      events: page,
      endCursor: page.length > 0 ? String(last) : null,
      nextCursor: last < events.length - 1 ? String(last) : null,
    };
  };
  return { events, fetchPage, callCount: () => calls };
}

const noopStore: CheckpointStore = { load: async () => null, save: async () => {} };

/** In-memory checkpoint store standing in for Mongo. */
function makeStore(initial?: CheckpointRecord) {
  let row: CheckpointRecord | null = initial ?? null;
  let saves = 0;
  const store: CheckpointStore = {
    load: async () => row,
    save: async (cp) => { row = { ...cp, updatedAt: new Date() }; saves++; },
  };
  return { store, row: () => row, saves: () => saves };
}

function resetCache() {
  delete (globalThis as { _principalReplayCache?: unknown })._principalReplayCache;
}

beforeEach(() => {
  process.env.PACKAGE_ID = '0xpkg';
  resetCache();
});

// ─── 1. Pure fold ──────────────────────────────────────────────────────────────

describe('replayPrincipal (pure fold)', () => {
  const SEQ: ReplayEvent[] = [
    ev(VAULT_A, 0, 1_000_000n),  // sweep  → 1.00
    ev(VAULT_A, 1, 400_000n),    // topup  → 0.60
    ev(VAULT_A, 0, 2_500_000n),  // sweep  → 3.10
    ev(VAULT_A, 1, 3_200_000n),  // topup > principal → clamp to 0
    ev(VAULT_A, 0, 700_000n),    // sweep  → 0.70
  ];

  test('sweeps add, topups subtract, over-withdrawal clamps to zero', () => {
    const r = replayPrincipal(SEQ);
    expect(r.principal).toBe(700_000n);
    expect(r.sweeps).toBe(3);
    expect(r.topups).toBe(2);
  });

  test('checkpoint fold ≡ full replay at every split point', () => {
    const full = replayPrincipal(SEQ);
    for (let k = 0; k <= SEQ.length; k++) {
      const checkpoint = replayPrincipal(SEQ.slice(0, k));
      const resumed = replayPrincipal(SEQ.slice(k), checkpoint);
      expect(resumed).toEqual(full);
    }
  });

  test('event-by-event fold (the cache pattern) ≡ full replay', () => {
    let state = replayPrincipal([]);
    for (const e of SEQ) state = replayPrincipal([e], state);
    expect(state).toEqual(replayPrincipal(SEQ));
  });

  test('clamp: eventless drain self-heals on the next sweep', () => {
    // sweep 19 → [redeem_position drains everything, emits NOTHING] → sweep 5.
    // Without the clamp, principal would be 19 + 5 = 24 and the earnings chip
    // would stay dead until the position grew past 24. The sweep's
    // savings_value_after (≈ its own amount — fresh position) clamps it to 5.
    const r = replayPrincipal([
      ev(VAULT_A, 0, 19_000_000n, 19_000_000n),
      // invisible drain — no event
      ev(VAULT_A, 0, 5_000_000n, 5_000_000n),
    ]);
    expect(r.principal).toBe(5_000_000n);
    // accrued from here: value 5.001 − principal 5.000 = 0.001 (correct again)
  });

  test('clamp is a no-op on a complete stream (basis ≤ value_after always)', () => {
    // Same sequence, but the drain IS emitted (post-upgrade behavior):
    // value_after reflects accrued interest, so it always exceeds basis.
    const complete: ReplayEvent[] = [
      ev(VAULT_A, 0, 1_000_000n, 1_000_000n),   // sweep → basis 1.00, value 1.00
      ev(VAULT_A, 0, 2_000_000n, 3_000_500n),   // sweep → basis 3.00, value 3.0005 (accrual)
      ev(VAULT_A, 1, 1_000_000n, 2_000_600n),   // topup → basis 2.00, value 2.0006
      ev(VAULT_A, 1, 2_000_700n, 0n),           // full drain, emitted → basis clamps 0
      ev(VAULT_A, 0, 700_000n, 700_000n),       // fresh sweep → basis 0.70
    ];
    const withClamp = replayPrincipal(complete);
    expect(withClamp.principal).toBe(700_000n);
    // and on streams without value_after at all, behavior is unchanged:
    const legacy = replayPrincipal(SEQ);
    expect(legacy.principal).toBe(700_000n);
    expect(legacy.sweeps).toBe(3);
  });

  test('malformed and zero-amount events are skipped', () => {
    const r = replayPrincipal([
      { contents: null },
      { contents: { json: null } },
      ev(VAULT_A, 0, 0n),
      { contents: { json: { vault_id: VAULT_A, direction: 7, amount: '999' } } },
      ev(VAULT_A, 0, 5n),
    ]);
    expect(r).toEqual({ principal: 5n, sweeps: 1, topups: 0 });
  });
});

// ─── 2. Derived reader with checkpoint cache ──────────────────────────────────

describe('getReplayedPrincipal (derived on-read)', () => {
  test('5 rapid sweep/topups: every read equals a fresh full replay — no intermediate wrong states', async () => {
    const stream = makeStream();
    const rebalances: Array<[0 | 1, bigint]> = [
      [0, 10_000_000n], // sweep  10.00
      [1, 3_000_000n],  // topup   3.00
      [0, 5_000_000n],  // sweep   5.00
      [1, 12_500_000n], // topup > principal → clamp
      [0, 20_090_000n], // sweep  20.09
    ];

    for (const [direction, amount] of rebalances) {
      stream.events.push(ev(VAULT_A, direction, amount));
      const got = await getReplayedPrincipal(VAULT_A, stream.fetchPage, noopStore);
      const fresh = replayPrincipal(forVault(stream.events, VAULT_A)).principal;
      expect(got).toBe(fresh); // cached incremental ≡ full replay, at every step
    }

    expect(await getReplayedPrincipal(VAULT_A, stream.fetchPage, noopStore)).toBe(20_090_000n);
  });

  test('repeated reads with no new events never re-apply (idempotent)', async () => {
    const stream = makeStream();
    stream.events.push(ev(VAULT_A, 0, 1_000_000n));
    const first = await getReplayedPrincipal(VAULT_A, stream.fetchPage, noopStore);
    for (let i = 0; i < 5; i++) {
      expect(await getReplayedPrincipal(VAULT_A, stream.fetchPage, noopStore)).toBe(first);
    }
    expect(first).toBe(1_000_000n);
  });

  test('interleaved multi-vault stream routes events to the right vault', async () => {
    const stream = makeStream();
    stream.events.push(
      ev(VAULT_A, 0, 1_000_000n),
      ev(VAULT_B, 0, 9_000_000n),
      ev(VAULT_A, 1, 250_000n),
      ev(VAULT_B, 1, 9_500_000n), // clamps B to 0
    );
    expect(await getReplayedPrincipal(VAULT_A, stream.fetchPage, noopStore)).toBe(750_000n);
    expect(await getReplayedPrincipal(VAULT_B, stream.fetchPage, noopStore)).toBe(0n);
  });

  test('pagination: many events across small pages fold exactly once', async () => {
    const stream = makeStream(3); // force multiple pages
    for (let i = 0; i < 10; i++) stream.events.push(ev(VAULT_A, 0, 1n));
    expect(await getReplayedPrincipal(VAULT_A, stream.fetchPage, noopStore)).toBe(10n);
    // second read: nothing new, value unchanged
    expect(await getReplayedPrincipal(VAULT_A, stream.fetchPage, noopStore)).toBe(10n);
  });

  test('cache loss is harmless: full replay rebuilds the same value', async () => {
    const stream = makeStream();
    stream.events.push(ev(VAULT_A, 0, 5_000_000n), ev(VAULT_A, 1, 1_000_000n));
    const before = await getReplayedPrincipal(VAULT_A, stream.fetchPage, noopStore);
    resetCache(); // simulate cold serverless instance / corrupted checkpoint
    const after = await getReplayedPrincipal(VAULT_A, stream.fetchPage, noopStore);
    expect(after).toBe(before);
    expect(after).toBe(4_000_000n);
  });

  test('concurrent reads share one refresh — events never fold twice', async () => {
    const stream = makeStream();
    stream.events.push(ev(VAULT_A, 0, 2_000_000n));
    const results = await Promise.all(
      Array.from({ length: 8 }, () => getReplayedPrincipal(VAULT_A, stream.fetchPage, noopStore)),
    );
    expect(results.every((r) => r === 2_000_000n)).toBe(true);
    expect(stream.callCount()).toBe(1); // one shared refresh, not eight
  });

  test('unknown vault (no events) reads as zero principal', async () => {
    const stream = makeStream();
    stream.events.push(ev(VAULT_A, 0, 1_000_000n));
    expect(await getReplayedPrincipal('0xnobody', stream.fetchPage, noopStore)).toBe(0n);
  });
});

// ─── 3. Mongo checkpoint layer (in-memory store stand-in) ─────────────────────

describe('checkpoint store', () => {
  const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3600 * 1000);

  test('genesis replay writes a checkpoint snapshot of its own output', async () => {
    const stream = makeStream();
    stream.events.push(ev(VAULT_A, 0, 7_000_000n), ev(VAULT_A, 1, 2_000_000n));
    const cp = makeStore();
    expect(await getReplayedPrincipal(VAULT_A, stream.fetchPage, cp.store)).toBe(5_000_000n);
    expect(cp.row()).toMatchObject({ vaultId: VAULT_A, principal: '5000000', eventCount: 2, cursor: '1' });
  });

  test('cold start seeds from a fresh checkpoint and folds ONLY post-cursor events', async () => {
    const stream = makeStream();
    stream.events.push(ev(VAULT_A, 0, 7_000_000n), ev(VAULT_A, 1, 2_000_000n)); // covered by checkpoint
    stream.events.push(ev(VAULT_A, 0, 4_000_000n));                              // new since checkpoint
    const cp = makeStore({ vaultId: VAULT_A, cursor: '1', principal: '5000000', eventCount: 2, updatedAt: new Date() });

    expect(await getReplayedPrincipal(VAULT_A, stream.fetchPage, cp.store)).toBe(9_000_000n);
    // checkpoint + remainder ≡ genesis replay
    expect(replayPrincipal(forVault(stream.events, VAULT_A)).principal).toBe(9_000_000n);
    expect(cp.row()).toMatchObject({ principal: '9000000', eventCount: 3, cursor: '2' });
  });

  test('fresh checkpoint is TRUSTED as-is, even if wrong (documented rule)', async () => {
    const stream = makeStream();
    stream.events.push(ev(VAULT_A, 0, 7_000_000n)); // genesis truth would be 7.00
    const cp = makeStore({ vaultId: VAULT_A, cursor: '0', principal: '999', eventCount: 1, updatedAt: new Date() });
    expect(await getReplayedPrincipal(VAULT_A, stream.fetchPage, cp.store)).toBe(999n);
  });

  test('stale checkpoint (>24h) triggers full replay and is OVERWRITTEN — the periodic verify', async () => {
    const stream = makeStream();
    stream.events.push(ev(VAULT_A, 0, 7_000_000n), ev(VAULT_A, 1, 2_000_000n));
    // corrupt AND stale: the verify corrects it
    const cp = makeStore({ vaultId: VAULT_A, cursor: '0', principal: '999', eventCount: 1, updatedAt: daysAgo(2) });

    expect(await getReplayedPrincipal(VAULT_A, stream.fetchPage, cp.store)).toBe(5_000_000n);
    expect(cp.row()).toMatchObject({ principal: '5000000', eventCount: 2 });
    expect(cp.saves()).toBe(1);
  });

  test('store failures are non-fatal: replay still answers from genesis', async () => {
    const stream = makeStream();
    stream.events.push(ev(VAULT_A, 0, 3_000_000n));
    const broken: CheckpointStore = {
      load: async () => { throw new Error('mongo down'); },
      save: async () => { throw new Error('mongo down'); },
    };
    expect(await getReplayedPrincipal(VAULT_A, stream.fetchPage, broken)).toBe(3_000_000n);
  });

  test('warm instance never re-reads the checkpoint store', async () => {
    const stream = makeStream();
    stream.events.push(ev(VAULT_A, 0, 1_000_000n));
    let loads = 0;
    const counting: CheckpointStore = {
      load: async () => { loads++; return null; },
      save: async () => {},
    };
    await getReplayedPrincipal(VAULT_A, stream.fetchPage, counting);
    await getReplayedPrincipal(VAULT_A, stream.fetchPage, counting);
    await getReplayedPrincipal(VAULT_A, stream.fetchPage, counting);
    expect(loads).toBe(1); // memory layer answers warm reads
  });
});
