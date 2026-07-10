/**
 * THE money formatter — every user-visible money string comes from here.
 *
 * Values FLOOR (never round). Rounding half-up made chat say "$1.00" while
 * the dashboard showed "$0.99" for the same 0.995 balance, and could display
 * money the user doesn't have. Flooring is exact in bigint space (no float
 * hazards like Math.floor(0.29 * 100) === 28) and keeps displayed pockets
 * summing to displayed totals.
 */

// Read env lazily so tests can set COIN_DECIMALS before first use.
function coinDecimals(): number {
  return parseInt(process.env.NEXT_PUBLIC_COIN_DECIMALS ?? process.env.COIN_DECIMALS ?? '9', 10);
}

function toBase(value: bigint | string | number): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.round(value)); // FP dust from Number(bigint) math
  return BigInt(value); // integer base-unit string
}

/**
 * Floor base units to `decimals` places; ungrouped ("1234.56").
 * Safe to round-trip through humanToBase (no thousands separators).
 */
export function floorToDecimals(base: bigint | string | number, decimals = 2): string {
  const DEC = coinDecimals();
  const b = toBase(base);
  const neg = b < 0n;
  const abs = neg ? -b : b;

  const kept = Math.min(decimals, DEC);           // fractional digits that exist in base units
  const scaled = abs / 10n ** BigInt(DEC - kept); // floor to `kept` decimal places
  const denom = 10n ** BigInt(kept);
  const whole = (scaled / denom).toString();
  const frac = (scaled % denom).toString().padStart(kept, '0').padEnd(decimals, '0');

  return `${neg ? '-' : ''}${whole}${decimals > 0 ? `.${frac}` : ''}`;
}

/**
 * Floor base units down to a whole-cent multiple (bigint-exact).
 * Use before summing pockets so the total matches the sum of displayed values
 * (floor(a) + floor(b) can differ from floor(a + b) by a cent).
 */
export function floorCentsBase(base: bigint | string | number): bigint {
  const cent = 10n ** BigInt(Math.max(0, coinDecimals() - 2));
  return (toBase(base) / cent) * cent;
}

/** Grouped display string: "1,234.56". Floors — see module doc. */
export function formatMoney(base: bigint | string | number, decimals = 2): string {
  const s = floorToDecimals(base, decimals);
  const neg = s.startsWith('-');
  const [whole, frac] = (neg ? s.slice(1) : s).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac !== undefined ? `.${frac}` : ''}`;
}

/**
 * Same as formatMoney but for human-decimal inputs ("12.3456" or 12.3456),
 * e.g. proposal amounts that were never in base units. Converts to integer
 * space first so the floor is exact.
 */
export function formatMoneyHuman(human: string | number, decimals = 2): string {
  const n = typeof human === 'number' ? human : parseFloat(human);
  if (!isFinite(n)) return String(human);
  return formatMoney(BigInt(Math.round(n * 10 ** coinDecimals())), decimals);
}
