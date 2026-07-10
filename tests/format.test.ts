/**
 * lib/format.ts is THE money formatter — every money string floors, never
 * rounds. Pins the bug class where chat said "$1.00" while the dashboard
 * showed "$0.99" for the same 0.995 balance (toFixed rounds half-up).
 */

// COIN_DECIMALS=6 is set in tests/setup-env.ts (jest setupFiles) — it must be
// in place before coin-config.ts loads, since that module reads env at import.
import { floorToDecimals, formatMoney, formatMoneyHuman, floorCentsBase } from '../lib/format.js';
import { baseToHuman, humanToBase } from '../lib/coin-config.js';

describe('floorToDecimals', () => {
  test('floors, never rounds — the $1.00 vs $0.99 symptom', () => {
    expect(floorToDecimals(995_000n)).toBe('0.99');       // toFixed(2) would say "1.00"
    expect(floorToDecimals(999_999n)).toBe('0.99');
    expect(floorToDecimals(1_000_000n)).toBe('1.00');
  });

  test('exact values pass through', () => {
    expect(floorToDecimals(50_000_000n)).toBe('50.00');
    expect(floorToDecimals(0n)).toBe('0.00');
    expect(floorToDecimals('20090000')).toBe('20.09');
  });

  test('higher precision floors at that precision', () => {
    expect(floorToDecimals(12_667n, 4)).toBe('0.0126');   // accrued chip
    expect(floorToDecimals(12_667n, 6)).toBe('0.012667');
  });

  test('decimals beyond COIN_DECIMALS pad with zeros', () => {
    expect(floorToDecimals(1_500_000n, 8)).toBe('1.50000000');
  });

  test('accepts number input (FP dust from bigint math is rounded off)', () => {
    expect(floorToDecimals(995_000.0000001)).toBe('0.99');
  });

  test('output round-trips through humanToBase (no grouping)', () => {
    const s = floorToDecimals(1_234_560_000n); // "1234.56"
    expect(s).toBe('1234.56');
    expect(humanToBase(s)).toBe(1_234_560_000n);
  });
});

describe('formatMoney', () => {
  test('groups thousands', () => {
    expect(formatMoney(1_234_567_890n)).toBe('1,234.56'); // floors the 789 tail
    expect(formatMoney(1_000_000_000_000n)).toBe('1,000,000.00');
  });

  test('small values ungrouped', () => {
    expect(formatMoney(995_000n)).toBe('0.99');
  });
});

describe('floorCentsBase', () => {
  test('floors base units to whole-cent multiples', () => {
    expect(floorCentsBase(995_000n)).toBe(990_000n);
    expect(floorCentsBase(1_000_000n)).toBe(1_000_000n);
  });

  test('chat total arithmetic matches dashboard: sum of floored pockets', () => {
    // Two 0.995 pockets: floor-then-sum = 1.98; sum-then-floor would say 1.99.
    const liquid = 995_000n;
    const savings = 995_000n;
    const total = floorCentsBase(liquid) + floorCentsBase(savings);
    expect(formatMoney(total)).toBe('1.98');
    expect(formatMoney(liquid + savings)).toBe('1.99'); // the trap avoided
  });
});

describe('formatMoneyHuman', () => {
  test('floors human-decimal strings exactly (no float floor hazard)', () => {
    expect(formatMoneyHuman('0.995')).toBe('0.99');
    expect(formatMoneyHuman('0.29')).toBe('0.29');   // Math.floor(0.29*100)===28 hazard
    expect(formatMoneyHuman(1.005)).toBe('1.00');
    expect(formatMoneyHuman('1234.567')).toBe('1,234.56');
  });

  test('non-numeric input passes through', () => {
    expect(formatMoneyHuman('abc')).toBe('abc');
  });
});

describe('baseToHuman (delegates to floorToDecimals)', () => {
  test('chat/brain strings now floor like the dashboard', () => {
    expect(baseToHuman(995_000n)).toBe('0.99');           // was "1.00" with toFixed
    expect(baseToHuman('20102646', 6)).toBe('20.102646');
    expect(baseToHuman(12_667n, 4)).toBe('0.0126');
  });
});
