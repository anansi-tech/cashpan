/**
 * Policy schedule math — PURE functions only (zero I/O, no model imports).
 *
 * The exactly-once guarantee for scheduled sends hangs on periodKey():
 * the worker's idempotency ledger is UNIQUE on (policyId, period), so two
 * dates in the same period MUST map to the same string, and the period must
 * roll over exactly when a new send becomes owed. All math is UTC.
 */

export type ScheduleKind = 'weekly' | 'monthly' | 'once';

export interface PolicySchedule {
  kind: ScheduleKind;
  /** ISO day of week, 1 = Monday … 7 = Sunday. Required for 'weekly'. */
  dayOfWeek?: number;
  /** 1–31; 29–31 clamp to the month's last day. Required for 'monthly'. */
  dayOfMonth?: number;
  /** YYYY-MM-DD (UTC). Required for 'once'. */
  dateUTC?: string;
  /** HH:MM, 24h UTC. */
  timeUTC: string;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Throws with a human-readable reason; API routes surface it verbatim. */
export function validateSchedule(s: PolicySchedule): void {
  if (!TIME_RE.test(s.timeUTC)) throw new Error(`Invalid timeUTC "${s.timeUTC}" (expected HH:MM)`);
  if (s.kind === 'weekly') {
    if (!Number.isInteger(s.dayOfWeek) || s.dayOfWeek! < 1 || s.dayOfWeek! > 7) {
      throw new Error('Weekly schedule needs dayOfWeek 1 (Mon) – 7 (Sun)');
    }
  } else if (s.kind === 'monthly') {
    if (!Number.isInteger(s.dayOfMonth) || s.dayOfMonth! < 1 || s.dayOfMonth! > 31) {
      throw new Error('Monthly schedule needs dayOfMonth 1–31');
    }
  } else if (s.kind === 'once') {
    if (!s.dateUTC || !DATE_RE.test(s.dateUTC) || isNaN(Date.parse(`${s.dateUTC}T00:00:00Z`))) {
      throw new Error('One-time schedule needs dateUTC (YYYY-MM-DD)');
    }
  } else {
    throw new Error(`Unknown schedule kind "${(s as { kind: string }).kind}"`);
  }
}

function parseTime(timeUTC: string): { h: number; m: number } {
  const m = TIME_RE.exec(timeUTC);
  if (!m) throw new Error(`Invalid timeUTC "${timeUTC}"`);
  return { h: Number(m[1]), m: Number(m[2]) };
}

/** ISO 8601 day of week for a UTC date: 1 = Monday … 7 = Sunday. */
function isoDow(d: Date): number {
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
}

/** ISO week-numbering {year, week} — year can differ from the calendar year at boundaries. */
function isoWeek(d: Date): { year: number; week: number } {
  // Shift to the Thursday of this ISO week; its calendar year IS the ISO year.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - isoDow(t));
  const year = t.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((t.getTime() - jan1) / 86_400_000 + 1) / 7);
  return { year, week };
}

function lastDayOfMonth(yearUTC: number, month0: number): number {
  return new Date(Date.UTC(yearUTC, month0 + 1, 0)).getUTCDate();
}

/**
 * The idempotency ledger key for the period containing `now`.
 * weekly → '2026-W31' (ISO week) · monthly → '2026-08' · once → 'once'.
 */
export function periodKey(schedule: PolicySchedule, now: Date): string {
  switch (schedule.kind) {
    case 'weekly': {
      const { year, week } = isoWeek(now);
      return `${year}-W${String(week).padStart(2, '0')}`;
    }
    case 'monthly':
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    case 'once':
      return 'once';
  }
}

/**
 * The scheduled datetime inside the period containing `now`.
 * Monthly day 29–31 clamps to the month's last day.
 */
export function occurrenceInPeriod(schedule: PolicySchedule, now: Date): Date {
  const { h, m } = parseTime(schedule.timeUTC);
  switch (schedule.kind) {
    case 'weekly': {
      const delta = schedule.dayOfWeek! - isoDow(now);
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta, h, m));
    }
    case 'monthly': {
      const day = Math.min(schedule.dayOfMonth!, lastDayOfMonth(now.getUTCFullYear(), now.getUTCMonth()));
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, h, m));
    }
    case 'once':
      return new Date(`${schedule.dateUTC}T${schedule.timeUTC.padStart(5, '0')}:00Z`);
  }
}

/** Scheduled time for this period has passed (the ledger decides if it already ran). */
export function isDue(schedule: PolicySchedule, now: Date): boolean {
  return now.getTime() >= occurrenceInPeriod(schedule, now).getTime();
}

/**
 * Next occurrence at-or-after `now` — display only ("next run" in Standing
 * orders). null for a 'once' whose datetime has passed.
 */
export function nextRun(schedule: PolicySchedule, now: Date): Date | null {
  const inPeriod = occurrenceInPeriod(schedule, now);
  if (inPeriod.getTime() >= now.getTime()) return inPeriod;
  switch (schedule.kind) {
    case 'weekly':
      return new Date(inPeriod.getTime() + 7 * 86_400_000);
    case 'monthly': {
      const y = now.getUTCFullYear();
      const m0 = now.getUTCMonth() + 1; // next month
      const day = Math.min(schedule.dayOfMonth!, lastDayOfMonth(y + Math.floor(m0 / 12), m0 % 12));
      const { h, m } = parseTime(schedule.timeUTC);
      return new Date(Date.UTC(y, m0, day, h, m));
    }
    case 'once':
      return null;
  }
}

const DOW_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/**
 * Plain-language schedule fragment for cards and Standing orders:
 * "Every Friday" · "On the 31st of each month (or month end)" · "Once on Aug 1, 2026".
 * Deliberately timeless — the exact time renders as a separate local-time row.
 */
export function scheduleSentence(schedule: PolicySchedule): string {
  switch (schedule.kind) {
    case 'weekly':
      return `Every ${DOW_NAMES[schedule.dayOfWeek! - 1]}`;
    case 'monthly':
      return `On the ${ordinal(schedule.dayOfMonth!)} of each month${schedule.dayOfMonth! >= 29 ? ' (or month end)' : ''}`;
    case 'once': {
      const d = new Date(`${schedule.dateUTC}T12:00:00Z`);
      return `Once on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
    }
  }
}
