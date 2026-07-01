#!/usr/bin/env node
/**
 * Resolve the Suilend main-pool native-USDC reserve_array_index dynamically.
 *
 * Fetches the live LendingMarket object and matches the reserve whose coinType
 * equals USDC_TYPE under a 0x-padding-tolerant normalize. Hard-fails if there
 * is not exactly one match or if mintDecimals ≠ 6, so a wrong reserve can
 * never slip through silently.
 *
 * Run standalone:   node scripts/resolve-suilend.mjs
 *   → resolves index, writes RESERVE_INDEX to .env, idempotent.
 *
 * Import as module: import { resolveReserveIndex } from './resolve-suilend.mjs'
 *   → call resolveReserveIndex(rpcUrl?) → { arrayIndex, mintDecimals }
 *
 * Constants (stable on-chain registry; safe to hardcode here):
 *   LENDING_MARKET_ID — the shared LendingMarket<MAIN_POOL> object
 *   USDC_TYPE         — native USDC (NOT bridged wUSDC)
 *
 * Dynamic (resolved live every deploy, never hardcoded in source):
 *   reserve_array_index — the integer Suilend uses to index into reserves[]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');

const DEFAULT_RPC   = 'https://fullnode.mainnet.sui.io:443';
const LENDING_MARKET_ID =
  '0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1';
const USDC_TYPE =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const EXPECTED_DECIMALS = 6;

/** Strip leading 0x and lowercase for padding-tolerant comparison. */
function normalize(coinType) {
  return coinType.toLowerCase().replace(/^0x/, '');
}

/**
 * Fetch the Suilend main-pool LendingMarket and return the reserve_array_index
 * for native USDC.
 *
 * @param {string} [rpcUrl]
 * @returns {Promise<{ arrayIndex: number, mintDecimals: number }>}
 */
export async function resolveReserveIndex(rpcUrl = process.env.SUI_RPC_URL ?? DEFAULT_RPC) {
  const client = new SuiJsonRpcClient({ url: rpcUrl, network: 'mainnet' });

  const obj = await client.getObject({
    id: LENDING_MARKET_ID,
    options: { showContent: true },
  });

  const fields  = obj.data?.content?.fields;
  const reserves = fields?.reserves;
  if (!Array.isArray(reserves)) {
    throw new Error(
      'LendingMarket.reserves not found in object — object structure may have changed',
    );
  }

  const target = normalize(USDC_TYPE);
  const matches = [];
  for (const r of reserves) {
    const name = r?.fields?.coin_type?.fields?.name ?? '';
    if (normalize(name) === target) matches.push(r.fields);
  }

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly 1 USDC reserve, found ${matches.length}. ` +
      `Matches: ${JSON.stringify(matches.map(m => m.coin_type?.fields?.name))}`,
    );
  }

  const reserve     = matches[0];
  const mintDecimals = Number(reserve.mint_decimals);
  if (mintDecimals !== EXPECTED_DECIMALS) {
    throw new Error(
      `USDC reserve has mint_decimals=${mintDecimals}, expected ${EXPECTED_DECIMALS}. Wrong reserve.`,
    );
  }

  // array_index is Suilend's own authoritative record of this reserve's position.
  const arrayIndex = Number(reserve.array_index);
  return { arrayIndex, mintDecimals };
}

/**
 * Idempotent .env patch: rewrite KEY=VALUE in-place if present, append if not.
 * Never touches other keys.
 *
 * @param {string} rootDir
 * @param {string} key
 * @param {string} value
 */
function patchEnvKey(rootDir, key, value) {
  const envPath = join(rootDir, '.env');
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const lines    = existing.split('\n');
  let found = false;
  const updated = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)/);
    if (m && m[1] === key) { found = true; return `${key}=${value}`; }
    return line;
  });
  if (!found) updated.push(`${key}=${value}`);
  writeFileSync(envPath, updated.join('\n').trimEnd() + '\n');
}

// ─── Standalone entry point ───────────────────────────────────────────────────
if (process.argv[1] === __filename) {
  const { arrayIndex, mintDecimals } = await resolveReserveIndex();
  console.log(
    `native-USDC reserve_array_index = ${arrayIndex}  (mint_decimals=${mintDecimals})`,
  );
  patchEnvKey(ROOT, 'RESERVE_INDEX', String(arrayIndex));
  console.log(`RESERVE_INDEX=${arrayIndex} written to .env`);
}
