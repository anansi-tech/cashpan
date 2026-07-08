#!/usr/bin/env node
/**
 * Reconcile savingsPrincipal against the full on-chain RebalanceEvent history.
 *
 * The live watcher starts from wherever the global cursor was first set, so any
 * sweep events that happened before the watcher was provisioned are missing from
 * the Mongo principal. This script replays from genesis (cursor = null) and
 * backfills the correct value.
 *
 * Usage:
 *   node scripts/reconcile-principal.mjs             # replay + write
 *   node scripts/reconcile-principal.mjs --dry-run   # show diff, no writes
 *
 * Assertion: after each write, reads back from Mongo and asserts the written
 * value equals the replayed value. Exits 1 if any assertion fails.
 *
 * TOPUP handling: uses simplified raw subtraction (principal = max(0, p - amount))
 * because historical savings value is unavailable without archive-node state.
 * This gives a conservative lower bound on principal. Acceptable for backfill
 * purposes since pre-migration positions are sweep-only.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Load .env ────────────────────────────────────────────────────────────────

const envLines = readFileSync(resolve(process.cwd(), '.env'), 'utf8').split('\n');
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq < 0) continue;
  const key = trimmed.slice(0, eq).trim();
  const val = trimmed.slice(eq + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

const GRAPHQL_URL = process.env.SUI_GRAPHQL_URL ?? '';
const GRPC_TOKEN  = process.env.SUI_GRPC_TOKEN ?? '';
const AUTH_HEADER = process.env.SUI_GRPC_AUTH_HEADER ?? 'x-token';
const MONGODB_URI = process.env.MONGODB_URI ?? '';
const PACKAGE_ID  = process.env.PACKAGE_ID ?? '';
const NETWORK     = process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'mainnet';
const DEC         = parseInt(process.env.COIN_DECIMALS ?? '6', 10);
const DRY_RUN     = process.argv.includes('--dry-run') || process.argv.includes('--fix-less');

if (!GRAPHQL_URL || !MONGODB_URI || !PACKAGE_ID) {
  console.error('Missing required env vars: SUI_GRAPHQL_URL, MONGODB_URI, PACKAGE_ID');
  process.exit(1);
}

const SWEEP = 0;
const TOPUP = 1;
const PAGE  = 50;

// ─── GraphQL helpers ──────────────────────────────────────────────────────────

async function gql(query) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: GRPC_TOKEN },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(`GraphQL: ${json.errors[0].message}`);
  return json.data;
}

/** Fetch every RebalanceEvent from genesis, no cursor start. */
async function fetchAllRebalanceEvents() {
  const eventType = `${PACKAGE_ID}::vault::RebalanceEvent`;
  const all = [];
  let cursor = null;
  let page = 0;

  while (true) {
    const after = cursor ? `, after: ${JSON.stringify(cursor)}` : '';
    const data = await gql(`{
      events(filter: { type: "${eventType}" }, first: ${PAGE}${after}) {
        nodes { contents { json } timestamp transaction { digest } }
        pageInfo { hasNextPage endCursor }
      }
    }`);

    const nodes = data?.events?.nodes ?? [];
    all.push(...nodes);
    page++;
    process.stdout.write(`\r  Fetching events… page ${page} (${all.length} total)`);

    const pageInfo = data?.events?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor ?? null;
    if (!cursor) break;
  }

  process.stdout.write('\n');
  return all;
}

// ─── Principal replay ─────────────────────────────────────────────────────────

/**
 * Replay events in chronological order (oldest-first as returned by GraphQL).
 * SWEEP: principal += amount
 * TOPUP: principal = max(0, principal - amount)  [simplified — no historical savings value]
 */
function replayPrincipal(events) {
  let principal = 0n;
  let sweeps = 0;
  let topups = 0;

  for (const ev of events) {
    const json = ev.contents?.json;
    if (!json) continue;

    const direction = Number(json.direction ?? -1);
    const amount    = BigInt(String(json.amount ?? '0'));
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

// ─── Display helper ───────────────────────────────────────────────────────────

function fmt(base) {
  return `${(Number(base) / 10 ** DEC).toFixed(DEC)} (${base} base)`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { MongoClient } = await import('mongodb');
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db();
  const col = db.collection('vaults');

  const vaults = await col.find({ network: NETWORK }).toArray();
  console.log(`\nFound ${vaults.length} vault(s) on ${NETWORK}`);
  if (DRY_RUN) console.log('(dry-run mode — no writes)\n');

  // Fetch all events once; filter per-vault in memory.
  console.log('Fetching ALL RebalanceEvents from genesis…');
  const allEvents = await fetchAllRebalanceEvents();
  console.log(`Total RebalanceEvents: ${allEvents.length}\n`);

  let exitCode = 0;
  let totalUpdated = 0;

  for (const vault of vaults) {
    const vaultId    = vault.vaultId;
    const mongoValue = BigInt(vault.savingsPrincipal ?? '0');
    const short      = vaultId.slice(0, 16) + '…';

    console.log(`── ${short}`);
    console.log(`   Mongo   : ${fmt(mongoValue)}`);

    // Filter events for this vault.
    const vaultEvents = allEvents.filter(ev => {
      const json = ev.contents?.json;
      return json && String(json.vault_id ?? '') === vaultId;
    });

    const { principal: replayed, sweeps, topups } = replayPrincipal(vaultEvents);
    console.log(`   Replayed: ${fmt(replayed)}  (${sweeps} sweeps, ${topups} topups)`);

    // Compute absolute diff.
    const diff    = replayed > mongoValue ? replayed - mongoValue : mongoValue - replayed;
    const diffPct = mongoValue > 0n
      ? (Number(diff) / Number(mongoValue) * 100).toFixed(2)
      : replayed > 0n ? '∞' : '0.00';
    console.log(`   Diff    : ${fmt(diff)} (${diffPct}%)`);

    if (diff === 0n) {
      console.log(`   ✓ Already in sync\n`);
      continue;
    }

    // Warn if diff is large and there are no topups (should be exact for sweep-only vaults).
    if (topups === 0 && diff > 0n) {
      console.log(`   ⚠  Sweep-only vault has non-zero diff — pre-migration events likely missing from watcher cursor`);
    }

    if (DRY_RUN) {
      console.log(`   → Would write: ${fmt(replayed)}\n`);
      totalUpdated++;
      continue;
    }

    // Write replayed value.
    await col.updateOne({ vaultId }, { $set: { savingsPrincipal: replayed.toString() } });

    // Assert: read back and verify.
    const updated = await col.findOne({ vaultId });
    const written = BigInt(updated?.savingsPrincipal ?? '-1');
    if (written === replayed) {
      console.log(`   ✓ Backfilled: ${fmt(mongoValue)} → ${fmt(replayed)}\n`);
      totalUpdated++;
    } else {
      console.error(`   ✗ ASSERT FAILED: wrote ${replayed}, read back ${written}\n`);
      exitCode = 1;
    }
  }

  console.log('─'.repeat(50));
  if (DRY_RUN) {
    console.log(`Would update: ${totalUpdated}/${vaults.length} vault(s)`);
  } else {
    console.log(`Updated: ${totalUpdated}/${vaults.length} vault(s)`);
  }

  await mongo.close();
  if (exitCode) process.exit(exitCode);
}

main().catch(err => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
