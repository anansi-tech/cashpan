/**
 * Period-key derivation is what makes scheduled sends exactly-once: the
 * worker's ledger is UNIQUE on (policyId, period), so every date inside one
 * period MUST yield the same key, and the key MUST change exactly at the
 * period boundary. Get this wrong and money double-sends or never sends.
 */

import {
  periodKey,
  occurrenceInPeriod,
  isDue,
  nextRun,
  scheduleSentence,
  validateSchedule,
  type PolicySchedule,
} from '../lib/policy-schedule.js';

const at = (iso: string) => new Date(iso);

const friday9: PolicySchedule = { kind: 'weekly', dayOfWeek: 5, timeUTC: '09:00' };
const monthly31: PolicySchedule = { kind: 'monthly', dayOfMonth: 31, timeUTC: '14:30' };
const onceAug1: PolicySchedule = { kind: 'once', dateUTC: '2026-08-01', timeUTC: '16:00' };

describe('periodKey', () => {
  test('weekly: every day of one ISO week maps to the same key', () => {
    // 2026-07-20 (Mon) … 2026-07-26 (Sun) are all ISO week 30.
    for (let d = 20; d <= 26; d++) {
      expect(periodKey(friday9, at(`2026-07-${d}T12:00:00Z`))).toBe('2026-W30');
    }
    expect(periodKey(friday9, at('2026-07-27T00:00:00Z'))).toBe('2026-W31');
  });

  test('weekly: ISO year boundary — Jan 1–3 2027 belong to 2026-W53', () => {
    // 2027-01-01 is a Friday; ISO week 53 of 2026.
    expect(periodKey(friday9, at('2027-01-01T12:00:00Z'))).toBe('2026-W53');
    expect(periodKey(friday9, at('2027-01-03T12:00:00Z'))).toBe('2026-W53'); // Sunday
    expect(periodKey(friday9, at('2027-01-04T12:00:00Z'))).toBe('2027-W01'); // Monday
  });

  test('monthly: calendar month key; boundary is exact', () => {
    expect(periodKey(monthly31, at('2026-07-31T23:59:59Z'))).toBe('2026-07');
    expect(periodKey(monthly31, at('2026-08-01T00:00:00Z'))).toBe('2026-08');
  });

  test('once: constant key — the ledger blocks any second run forever', () => {
    expect(periodKey(onceAug1, at('2026-08-01T16:00:00Z'))).toBe('once');
    expect(periodKey(onceAug1, at('2030-01-01T00:00:00Z'))).toBe('once');
  });
});

describe('occurrenceInPeriod + isDue', () => {
  test('weekly: occurrence is this ISO week’s target day at timeUTC', () => {
    // Wed 2026-07-22 → Friday of the same week is 2026-07-24.
    expect(occurrenceInPeriod(friday9, at('2026-07-22T12:00:00Z')).toISOString())
      .toBe('2026-07-24T09:00:00.000Z');
    // Sunday (ISO dow 7) still resolves BACK to Friday of the same week.
    expect(occurrenceInPeriod(friday9, at('2026-07-26T12:00:00Z')).toISOString())
      .toBe('2026-07-24T09:00:00.000Z');
  });

  test('weekly: not due before the moment, due at and after it', () => {
    expect(isDue(friday9, at('2026-07-24T08:59:59Z'))).toBe(false);
    expect(isDue(friday9, at('2026-07-24T09:00:00Z'))).toBe(true);
    expect(isDue(friday9, at('2026-07-26T23:00:00Z'))).toBe(true); // late in period still due
  });

  test('monthly day 31 clamps to month end (Feb 2026 → 28)', () => {
    expect(occurrenceInPeriod(monthly31, at('2026-02-10T00:00:00Z')).toISOString())
      .toBe('2026-02-28T14:30:00.000Z');
    // Leap year: Feb 2028 → 29.
    expect(occurrenceInPeriod(monthly31, at('2028-02-10T00:00:00Z')).toISOString())
      .toBe('2028-02-29T14:30:00.000Z');
    // 31-day month: no clamp.
    expect(occurrenceInPeriod(monthly31, at('2026-07-01T00:00:00Z')).toISOString())
      .toBe('2026-07-31T14:30:00.000Z');
  });

  test('once: due exactly from its datetime', () => {
    expect(isDue(onceAug1, at('2026-08-01T15:59:59Z'))).toBe(false);
    expect(isDue(onceAug1, at('2026-08-01T16:00:00Z'))).toBe(true);
  });
});

describe('nextRun', () => {
  test('weekly: this week’s occurrence if still ahead, else +7 days', () => {
    expect(nextRun(friday9, at('2026-07-22T12:00:00Z'))!.toISOString())
      .toBe('2026-07-24T09:00:00.000Z');
    expect(nextRun(friday9, at('2026-07-24T10:00:00Z'))!.toISOString())
      .toBe('2026-07-31T09:00:00.000Z');
  });

  test('monthly: rolls into next month with clamping (Jan 31 → Feb 28)', () => {
    expect(nextRun(monthly31, at('2026-01-31T15:00:00Z'))!.toISOString())
      .toBe('2026-02-28T14:30:00.000Z');
    // December rolls into January of the next year.
    expect(nextRun(monthly31, at('2026-12-31T15:00:00Z'))!.toISOString())
      .toBe('2027-01-31T14:30:00.000Z');
  });

  test('once: the datetime while future, null after', () => {
    expect(nextRun(onceAug1, at('2026-07-23T00:00:00Z'))!.toISOString())
      .toBe('2026-08-01T16:00:00.000Z');
    expect(nextRun(onceAug1, at('2026-08-02T00:00:00Z'))).toBeNull();
  });
});

describe('validateSchedule', () => {
  test('accepts the three canonical shapes', () => {
    expect(() => validateSchedule(friday9)).not.toThrow();
    expect(() => validateSchedule(monthly31)).not.toThrow();
    expect(() => validateSchedule(onceAug1)).not.toThrow();
  });

  test('rejects malformed inputs with readable reasons', () => {
    expect(() => validateSchedule({ kind: 'weekly', timeUTC: '09:00' })).toThrow(/dayOfWeek/);
    expect(() => validateSchedule({ kind: 'weekly', dayOfWeek: 0, timeUTC: '09:00' })).toThrow(/dayOfWeek/);
    expect(() => validateSchedule({ kind: 'monthly', dayOfMonth: 32, timeUTC: '09:00' })).toThrow(/dayOfMonth/);
    expect(() => validateSchedule({ kind: 'once', timeUTC: '09:00' })).toThrow(/dateUTC/);
    expect(() => validateSchedule({ kind: 'weekly', dayOfWeek: 5, timeUTC: '25:00' })).toThrow(/timeUTC/);
  });
});

describe('scheduleSentence', () => {
  test('reads as plain language', () => {
    expect(scheduleSentence(friday9)).toBe('Every Friday');
    expect(scheduleSentence(monthly31)).toBe('On the 31st of each month (or month end)');
    expect(scheduleSentence({ kind: 'monthly', dayOfMonth: 1, timeUTC: '09:00' }))
      .toBe('On the 1st of each month');
    expect(scheduleSentence(onceAug1)).toBe('Once on Aug 1, 2026');
  });
});
