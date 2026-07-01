/**
 * Startup assertion: re-validates RESERVE_INDEX from env against the live
 * Suilend LendingMarket coinType lookup.
 *
 * Called once per server process from page.tsx. If RESERVE_INDEX has drifted
 * (Suilend added reserves before index 7), logs a loud warning so the operator
 * knows to re-run: node scripts/resolve-suilend.mjs && npm run setup.
 *
 * Non-fatal — the app continues; the warning goes to server stderr.
 */

import { suiClient } from './sui';

const LENDING_MARKET_ID = '0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1';
const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

let checked = false;

function normalize(coinType: string): string {
  return coinType.toLowerCase().replace(/^0x/, '');
}

function getReserveArrayIndex(reserve: unknown): number {
  const fields = (reserve as Record<string, unknown>)?.fields as Record<string, unknown> | undefined;
  return Number(fields?.array_index ?? -1);
}

function getReserveCoinTypeName(reserve: unknown): string {
  const fields = (reserve as Record<string, unknown>)?.fields as Record<string, unknown> | undefined;
  const coinType = fields?.coin_type as { fields?: { name?: string } } | undefined;
  return coinType?.fields?.name ?? '';
}

/**
 * Fire-and-forget startup check. Safe to call with `void validateReserveIndex()`.
 * No-ops on subsequent calls within the same server process.
 */
export async function validateReserveIndex(): Promise<void> {
  if (checked) return;
  checked = true;

  const envIdx = process.env.RESERVE_INDEX;
  if (!envIdx) return;

  try {
    const client = suiClient();
    const obj = await client.getObject({ id: LENDING_MARKET_ID, options: { showContent: true } });
    const content = obj.data?.content;
    if (content?.dataType !== 'moveObject') return;
    const topFields = content.fields as Record<string, unknown>;
    const reserves = topFields.reserves as unknown[] | undefined;
    if (!Array.isArray(reserves)) return;

    const target = normalize(USDC_TYPE);
    const liveReserve = reserves.find(
      (r) => normalize(getReserveCoinTypeName(r)) === target,
    );

    if (!liveReserve) {
      console.warn('[CashPan] WARN: Could not find native-USDC reserve in live Suilend LendingMarket.');
      return;
    }

    const liveIdx   = getReserveArrayIndex(liveReserve);
    const envIdxNum = Number(envIdx);

    if (liveIdx !== envIdxNum) {
      console.warn(
        `\n⚠️  [CashPan] RESERVE_INDEX DRIFT DETECTED\n` +
        `   env RESERVE_INDEX = ${envIdxNum}\n` +
        `   live array_index  = ${liveIdx}\n` +
        `   Action required: node scripts/resolve-suilend.mjs && npm run setup\n`,
      );
    }
  } catch {
    // Non-fatal — silently skip if RPC unreachable at startup
  }
}
