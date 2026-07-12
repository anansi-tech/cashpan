/**
 * Cash-out poll classifier. Pins the regression: a PRIOR terminal transaction
 * matched as "newest" before the new order propagated → live session cleared
 * → arrival recovery raced a real cash-out. Historical transactions must be
 * invisible to a session.
 */

import { classifyOfframpPoll, CLOCK_SKEW_MS, ORDER_WINDOW_MS, type PolledTx } from '../lib/offramp-match.js';

const T0 = new Date('2026-07-12T12:00:00Z').getTime(); // session start
const iso = (ms: number) => new Date(ms).toISOString();

const tx = (over: Partial<PolledTx>): PolledTx => ({
  status: 'TRANSACTION_STATUS_STARTED',
  toAddress: '0xcb',
  sellAmount: '2',
  createdAt: iso(T0 + 60_000),
  ...over,
});

describe('session gate — historical transactions are invisible', () => {
  test('REGRESSION: prior terminal SUCCESS (yesterday) never concludes a new session', () => {
    const historical = tx({ status: 'TRANSACTION_STATUS_SUCCESS', createdAt: iso(T0 - 12 * 3600_000) });
    expect(classifyOfframpPoll(historical, T0, 'waiting', T0 + 5_000)).toBe('wait');
    // …and never terminates a post-send session either
    expect(classifyOfframpPoll(historical, T0, 'sent', T0 + 5_000)).toBe('wait');
  });

  test('historical FAILED cannot expire a fresh session', () => {
    const historical = tx({ status: 'TRANSACTION_STATUS_FAILED', createdAt: iso(T0 - 3600_000) });
    expect(classifyOfframpPoll(historical, T0, 'waiting', T0 + 5_000)).toBe('wait');
  });

  test('clock skew: order stamped slightly BEFORE session start still matches', () => {
    const skewed = tx({ createdAt: iso(T0 - CLOCK_SKEW_MS + 10_000) });
    expect(classifyOfframpPoll(skewed, T0, 'waiting', T0 + 5_000)).toBe('confirm');
  });

  test('beyond the skew allowance → historical', () => {
    const tooOld = tx({ createdAt: iso(T0 - CLOCK_SKEW_MS - 10_000) });
    expect(classifyOfframpPoll(tooOld, T0, 'waiting', T0 + 5_000)).toBe('wait');
  });
});

describe('the spec scenario — order appears 60s into the session', () => {
  test('polls before propagation wait; the NEW order then drives confirm', () => {
    // seed: only the historical terminal tx visible at first
    const historical = tx({ status: 'TRANSACTION_STATUS_SUCCESS', createdAt: iso(T0 - 24 * 3600_000) });
    expect(classifyOfframpPoll(historical, T0, 'waiting', T0 + 30_000)).toBe('wait');
    expect(classifyOfframpPoll(null, T0, 'waiting', T0 + 45_000)).toBe('wait');
    // 60s later the real order lands
    const fresh = tx({ createdAt: iso(T0 + 60_000) });
    expect(classifyOfframpPoll(fresh, T0, 'waiting', T0 + 65_000)).toBe('confirm');
  });

  test('after the send, the same order reaching SUCCESS pays out', () => {
    const done = tx({ status: 'TRANSACTION_STATUS_SUCCESS', createdAt: iso(T0 + 60_000) });
    expect(classifyOfframpPoll(done, T0, 'sent', T0 + 300_000)).toBe('paid');
  });

  test('failure after send is failed; before send is expired', () => {
    const dead = tx({ status: 'TRANSACTION_STATUS_FAILED', createdAt: iso(T0 + 60_000) });
    expect(classifyOfframpPoll(dead, T0, 'sent', T0 + 300_000)).toBe('failed');
    expect(classifyOfframpPoll(dead, T0, 'waiting', T0 + 300_000)).toBe('expired');
  });

  test('30-minute window: unsigned order past the window expires', () => {
    const order = tx({ createdAt: iso(T0 + 60_000) });
    expect(classifyOfframpPoll(order, T0, 'waiting', T0 + 60_000 + ORDER_WINDOW_MS + 1)).toBe('expired');
  });

  test('order without address/amount yet stays waiting', () => {
    const partial = tx({ toAddress: undefined });
    expect(classifyOfframpPoll(partial, T0, 'waiting', T0 + 65_000)).toBe('wait');
  });
});
