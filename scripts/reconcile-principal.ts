#!/usr/bin/env tsx
/**
 * Reconcile savingsPrincipal against the full on-chain RebalanceEvent history.
 *
 * Replays from genesis (cursor = null) and writes the correct value.
 * Shares replayPrincipal() with lib/watcher.ts — single implementation, no drift.
 *
 * Usage:
 *   npm run reconcile             # replay + write
 *   npm run reconcile -- --dry-run
 *   npm run reconcile -- --fix-less  (alias for --dry-run)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { MongoClient } from 'mongodb';
import { replayPrincipal } from '../lib/principal-replay';

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

const PAGE = 50;

// ─── GraphQL helpers ──────────────────────────────────────────────────────────

async function gql(query: string): Promise<unknown> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: GRPC_TOKEN },
    body: JSON.stringify({ query }),
  });
  const json = await res.json() as { data: unknown; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`GraphQL: ${json.errors[0].message}`);
  return json.data;
}

interface EventNode {
  contents?: { json?: Record<string, unknown> | null } | null;
}

async function fetchAllRebalanceEvents(): Promise<EventNode[]> {
  const eventType = `${PACKAGE_ID}::vault::RebalanceEvent`;
  const all: EventNode[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    const after = cursor ? `, after: ${JSON.stringify(cursor)}` : '';
    const data = await gql(`{
      events(filter: { type: "${eventType}" }, first: ${PAGE}${after}) {
        nodes { contents { json } timestamp transaction { digest } }
        pageInfo { hasNextPage endCursor }
      }
    }`) as { events?: { nodes?: EventNode[]; pageInfo?: { hasNextPage: boolean; endCursor?: string | null } } };

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

// ─── Display helper ───────────────────────────────────────────────────────────

function fmt(base: bigint): string {
  return `${(Number(base) / 10 ** DEC).toFixed(DEC)} (${base} base)`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db();
  const col = db.collection('vaults');

  const vaults = await col.find({ network: NETWORK }).toArray();
  console.log(`\nFound ${vaults.length} vault(s) on ${NETWORK}`);
  if (DRY_RUN) console.log('(dry-run mode — no writes)\n');

  console.log('Fetching ALL RebalanceEvents from genesis…');
  const allEvents = await fetchAllRebalanceEvents();
  console.log(`Total RebalanceEvents: ${allEvents.length}\n`);

  let exitCode = 0;
  let totalUpdated = 0;

  for (const vault of vaults) {
    const vaultId    = vault.vaultId as string;
    const mongoValue = BigInt(vault.savingsPrincipal ?? '0');
    const short      = vaultId.slice(0, 16) + '…';

    console.log(`── ${short}`);
    console.log(`   Mongo   : ${fmt(mongoValue)}`);

    const vaultEvents = allEvents.filter(ev => {
      const json = ev.contents?.json;
      return json && String(json.vault_id ?? '') === vaultId;
    });

    const { principal: replayed, sweeps, topups } = replayPrincipal(vaultEvents);
    console.log(`   Replayed: ${fmt(replayed)}  (${sweeps} sweeps, ${topups} topups)`);

    const diff    = replayed > mongoValue ? replayed - mongoValue : mongoValue - replayed;
    const diffPct = mongoValue > 0n
      ? (Number(diff) / Number(mongoValue) * 100).toFixed(2)
      : replayed > 0n ? '∞' : '0.00';
    console.log(`   Diff    : ${fmt(diff)} (${diffPct}%)`);

    if (diff === 0n) {
      console.log(`   ✓ Already in sync\n`);
      continue;
    }

    if (topups === 0 && diff > 0n) {
      console.log(`   ⚠  Sweep-only vault has non-zero diff — pre-migration events likely missing from watcher cursor`);
    }

    if (DRY_RUN) {
      console.log(`   → Would write: ${fmt(replayed)}\n`);
      totalUpdated++;
      continue;
    }

    await col.updateOne({ vaultId }, { $set: { savingsPrincipal: replayed.toString() } });

    const updated = await col.findOne({ vaultId });
    const written = BigInt(updated?.savingsPrincipal ?? '-1');
    if (written === replayed) {
      console.log(`   ✓ Written: ${fmt(mongoValue)} → ${fmt(replayed)}\n`);
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
  console.error('Fatal:', (err as Error).message ?? err);
  process.exit(1);
});
