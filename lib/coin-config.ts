/**
 * Single source of truth for decimal ↔ base-unit conversion.
 *
 * Set COIN_DECIMALS and COIN_SYMBOL in .env to switch stablecoins — no code change needed.
 *   COIN_DECIMALS=6  COIN_SYMBOL=USD   → test_usd / USDC
 *   COIN_DECIMALS=9  COIN_SYMBOL=SUI   → native SUI
 */

const DECIMALS = parseInt(process.env.COIN_DECIMALS ?? '9', 10);
const FACTOR = 10 ** DECIMALS;

export const COIN_DECIMALS = DECIMALS;
export const COIN_SYMBOL = process.env.COIN_SYMBOL ?? 'SUI';

/** Human decimal string → base-unit bigint.  e.g. "50" → 50_000_000n (6 dec) */
export function humanToBase(human: string): bigint {
  const f = parseFloat(human);
  if (!isFinite(f) || f < 0) throw new Error(`Invalid amount: ${human}`);
  return BigInt(Math.round(f * FACTOR));
}

/** Base-unit bigint/string → display decimal.  e.g. 50_000_000n → "50.00" (6 dec) */
export function baseToHuman(base: bigint | string | number, displayDecimals = 2): string {
  return (Number(base) / FACTOR).toFixed(displayDecimals);
}

/** Base-unit → formatted with $ prefix.  e.g. 50_000_000n → "$50.00" */
export function formatCoin(base: bigint | string | number, displayDecimals = 2): string {
  return `$${baseToHuman(base, displayDecimals)}`;
}
