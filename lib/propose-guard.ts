/**
 * Server-side guard against model misparses of money amounts.
 *
 * Incident (3x): "top me up with 5 dollars" → the model omitted the amount and
 * the old omitted-amount-means-drain convention proposed draining ~$31.69.
 * The tool split (numeric tools vs explicit drain tools) makes that encoding
 * impossible; this guard is the belt on top: never propose more than the
 * number the user actually said.
 */

import { humanToBase } from './coin-config';

/**
 * Money-like numbers in a user message. Ignores hex addresses, percentages,
 * and absurd magnitudes. "top me up with 5 dollars" → [5].
 */
export function extractMoneyNumbers(text: string): number[] {
  const cleaned = text
    .replace(/0x[0-9a-fA-F]+/g, ' ')   // addresses
    .replace(/\d+(?:\.\d+)?\s*%/g, ' '); // percentages
  const out: number[] = [];
  const re = /\$?\s?(\d+(?:\.\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const n = parseFloat(m[1]);
    if (isFinite(n) && n > 0 && n < 1_000_000) out.push(n);
  }
  return out;
}

export type GuardResult = { ok: true } | { ok: false; userNumber: number };

/**
 * For numeric proposals (topup/sweep with an explicit amount): if the proposal
 * takes more than half the source balance while the user's message names a
 * smaller plausible amount (≤ source balance), reject — the model must re-ask
 * or use the user's number.
 */
export function guardNumericAmount(
  userText: string,
  amountHuman: string,
  sourceBalanceBase: bigint,
): GuardResult {
  const amountBase = humanToBase(amountHuman);
  if (amountBase * 2n <= sourceBalanceBase) return { ok: true }; // ≤ 50% — plausible

  const candidates = extractMoneyNumbers(userText)
    .filter((n) => humanToBase(String(n)) <= sourceBalanceBase);
  if (candidates.length === 0) return { ok: true }; // user named nothing usable

  const largest = Math.max(...candidates);
  if (amountBase > humanToBase(String(largest))) return { ok: false, userNumber: largest };
  return { ok: true };
}

/**
 * For POLICY proposals (recurring sends): strictest form — a standing order
 * executes forever, so when the user's message names any money number, the
 * policy amount must BE one of those numbers exactly. "send mom $5 weekly"
 * can never author a $50 policy.
 */
export function guardExactAmount(userText: string, amountHuman: string): GuardResult {
  const candidates = extractMoneyNumbers(userText);
  if (candidates.length === 0) return { ok: true }; // amount came from a form/prior turn
  const amount = parseFloat(amountHuman);
  if (candidates.some((n) => Math.abs(n - amount) < 1e-9)) return { ok: true };
  return { ok: false, userNumber: Math.max(...candidates) };
}

/**
 * For drain proposals: a drain is only legitimate when the user did NOT name
 * a specific amount to move. Numbers matching keepInSave are expected
 * ("keep $19, move the rest"); any other plausible number means the model
 * misrouted a numeric request into the drain tool.
 */
export function guardDrain(
  userText: string,
  sourceBalanceBase: bigint,
  keepInSaveHuman?: string,
): GuardResult {
  const keep = keepInSaveHuman ? parseFloat(keepInSaveHuman) : undefined;
  const candidates = extractMoneyNumbers(userText)
    .filter((n) => humanToBase(String(n)) <= sourceBalanceBase)
    .filter((n) => keep === undefined || Math.abs(n - keep) > 1e-9);
  if (candidates.length === 0) return { ok: true };
  return { ok: false, userNumber: Math.max(...candidates) };
}
