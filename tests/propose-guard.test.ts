/**
 * Guards against model misparses of money amounts in chat.
 *
 * Incident (3x): "top me up with 5 dollars" → model omitted the amount →
 * old omitted-amount-means-drain convention proposed draining ~$31.69.
 * The tool split makes that encoding impossible; these tests pin the guard
 * that rejects any remaining misroute server-side.
 */

import { extractMoneyNumbers, guardNumericAmount, guardDrain } from '../lib/propose-guard.js';

const SAVINGS = 31_690_000n; // $31.69 — the balance from the incident

describe('extractMoneyNumbers', () => {
  test.each([
    ['top me up with 5 dollars', [5]],
    ['top me up with $5', [5]],
    ['move 5 bucks to spending', [5]],
    ['give me 12.50', [12.5]],
    ['move everything to spend', []],
    ['top up', []],
    ['send 5 to 0x0b4fb29213b986468deadbeef', [5]],   // hex address ignored
    ['save 50% of my money', []],                      // percentage ignored
  ])('%s → %j', (text, expected) => {
    expect(extractMoneyNumbers(text)).toEqual(expected);
  });
});

describe('guardNumericAmount (topup/sweep with explicit amount)', () => {
  test('the incident phrase with the right amount passes', () => {
    expect(guardNumericAmount('top me up with 5 dollars', '5', SAVINGS)).toEqual({ ok: true });
  });

  test('proposal larger than the number the user said is rejected', () => {
    // model inflated $5 → $31.69 (over 50% of source, user said 5)
    expect(guardNumericAmount('top me up with 5 dollars', '31.69', SAVINGS))
      .toEqual({ ok: false, userNumber: 5 });
  });

  test('large amounts pass when the user actually named them', () => {
    expect(guardNumericAmount('move 30 dollars to spending', '30', SAVINGS)).toEqual({ ok: true });
  });

  test('no numbers in the message → cannot second-guess, pass', () => {
    expect(guardNumericAmount('top up my spending please', '20', SAVINGS)).toEqual({ ok: true });
  });
});

describe('guardDrain (everything-intents only)', () => {
  test.each([
    'top me up with 5 dollars',
    'move $5 to spend',
    'give me 5 bucks in spending',
  ])('incident phrasing rejected: %s', (text) => {
    expect(guardDrain(text, SAVINGS)).toEqual({ ok: false, userNumber: 5 });
  });

  test('genuine everything-intents pass', () => {
    expect(guardDrain('move everything to spend', SAVINGS)).toEqual({ ok: true });
    expect(guardDrain('move all my savings to spending', SAVINGS)).toEqual({ ok: true });
  });

  test('keep-the-rest phrasing passes when the number IS the keep amount', () => {
    expect(guardDrain('keep 19 in save and move the rest', SAVINGS, '19')).toEqual({ ok: true });
  });

  test('keep phrasing with a DIFFERENT number still rejects', () => {
    expect(guardDrain('keep 19, move 5 to spend', SAVINGS, '19')).toEqual({ ok: false, userNumber: 5 });
  });

  test('numbers larger than the balance are not treated as amounts', () => {
    expect(guardDrain('move everything, I need it for the 500 dollar rent', 31_690_000n))
      .toEqual({ ok: true });
  });
});
