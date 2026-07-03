#!/usr/bin/env node
/**
 * Pre-merge smoke test for every production GraphQL query.
 * Requires SUI_GRAPHQL_URL, SUI_GRPC_TOKEN, SUI_GRPC_AUTH_HEADER,
 * COIN_TYPE, PACKAGE_ID, VAULT_ID in the environment (loaded from .env).
 *
 * Usage:
 *   node scripts/verify-graphql.mjs
 *
 * Exit 0 = all queries returned data without errors.
 * Exit 1 = any query errored or returned unexpected shape.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env manually (no dotenv dependency needed for a script)
const envPath = resolve(process.cwd(), '.env');
const envLines = readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq < 0) continue;
  const key = trimmed.slice(0, eq).trim();
  const val = trimmed.slice(eq + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

const URL   = process.env.SUI_GRAPHQL_URL ?? '';
const TOKEN = process.env.SUI_GRPC_TOKEN ?? '';
const HDR   = process.env.SUI_GRPC_AUTH_HEADER ?? 'x-token';
const COIN  = process.env.COIN_TYPE ?? '';
const PKG   = process.env.PACKAGE_ID ?? '';
// Use any known on-chain object for the object-read query (VENUE_ID is always set by setup).
// Per-user VAULT_ID is stored in MongoDB and not available here.
const OBJ   = process.env.VENUE_ID ?? process.env.VAULT_ID ?? '';

if (!URL || !COIN || !PKG || !OBJ) {
  console.error('Missing required env vars: SUI_GRAPHQL_URL, COIN_TYPE, PACKAGE_ID, VENUE_ID');
  process.exit(1);
}

// Placeholder address used for wallet balance query
const DUMMY_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000001';

async function gql(label, query) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [HDR]: TOKEN },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`${label}: ${json.errors[0].message}`);
  }
  if (!json.data) {
    throw new Error(`${label}: no data returned`);
  }
  return json.data;
}

const CHECKS = [
  {
    label: 'epoch',
    query: '{ epoch { epochId } }',
    assert: (d) => d.epoch?.epochId != null,
  },
  {
    label: 'object read (venue)',
    query: `{ obj: object(address: "${OBJ}") { asMoveObject { contents { json } } } }`,
    assert: (d) => d.obj?.asMoveObject?.contents?.json != null,
  },
  {
    label: 'wallet balance',
    query: `{ wallet: address(address: "${DUMMY_ADDR}") { balance(coinType: "${COIN}") { totalBalance } } }`,
    // totalBalance may be null for a zero-balance address — the field existing is what matters
    assert: (d) => d.wallet !== undefined,
  },
  {
    label: 'combined object+epoch+balance',
    query: `{
      epoch { epochId }
      obj: object(address: "${OBJ}") { asMoveObject { contents { json } } }
      wallet: address(address: "${DUMMY_ADDR}") { balance(coinType: "${COIN}") { totalBalance } }
    }`,
    assert: (d) => d.epoch?.epochId != null && d.obj?.asMoveObject?.contents?.json != null,
  },
  {
    label: 'events (rebalance type filter)',
    query: `{
      events(filter: { type: "${PKG}::vault::RebalanceEvent" }, last: 1) {
        nodes { contents { json } timestamp transaction { digest } }
      }
    }`,
    assert: (d) => Array.isArray(d.events?.nodes),
  },
];

let passed = 0;
let failed = 0;

for (const check of CHECKS) {
  try {
    const data = await gql(check.label, check.query);
    if (!check.assert(data)) {
      console.error(`FAIL [${check.label}]: assertion failed. data =`, JSON.stringify(data).slice(0, 200));
      failed++;
    } else {
      console.log(`PASS [${check.label}]`);
      passed++;
    }
  } catch (err) {
    console.error(`FAIL [${check.label}]:`, err.message);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
