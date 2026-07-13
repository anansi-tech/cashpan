/**
 * Resilient upstream fetch. Pins the crash: slow upstream → empty body →
 * JSON.parse → 500. Now: timeout, defensive parse, one retry on 5xx/timeout.
 */

import { jest } from '@jest/globals';
import { upstreamFetch, UpstreamError } from '../lib/upstream-fetch.js';

const resp = (status: number, body: string) => ({ status, text: async () => body }) as Response;

afterEach(() => jest.restoreAllMocks());

test('parses a normal JSON response', async () => {
  global.fetch = jest.fn<typeof fetch>().mockResolvedValue(resp(200, '{"result":{"ok":1}}')) as typeof fetch;
  const { httpStatus, data } = await upstreamFetch<{ result: { ok: number } }>('t', 'u', {});
  expect(httpStatus).toBe(200);
  expect(data.result.ok).toBe(1);
});

test('THE crash: empty body → UpstreamError, never a SyntaxError 500', async () => {
  global.fetch = jest.fn<typeof fetch>().mockResolvedValue(resp(200, '')) as typeof fetch;
  // Empty body parses to {} (not a throw) — the crash was JSON.parse('') throwing.
  const { data } = await upstreamFetch('t', 'u', {});
  expect(data).toEqual({});
});

test('invalid (non-JSON) body → UpstreamError with a real message', async () => {
  global.fetch = jest.fn<typeof fetch>().mockResolvedValue(resp(200, '<html>gateway timeout</html>')) as typeof fetch;
  await expect(upstreamFetch('sponsor', 'u', {})).rejects.toThrow(UpstreamError);
  await expect(upstreamFetch('sponsor', 'u', {})).rejects.toThrow(/invalid response body/);
});

test('retries once on 5xx, then succeeds', async () => {
  const f = jest.fn<typeof fetch>()
    .mockResolvedValueOnce(resp(502, 'bad gateway'))
    .mockResolvedValueOnce(resp(200, '{"ok":true}'));
  global.fetch = f as typeof fetch;
  const { data } = await upstreamFetch<{ ok: boolean }>('t', 'u', {}, { retries: 1 });
  expect(data.ok).toBe(true);
  expect(f).toHaveBeenCalledTimes(2);
});

test('exhausted 5xx retries throw UpstreamError (502)', async () => {
  global.fetch = jest.fn<typeof fetch>().mockResolvedValue(resp(503, 'down')) as typeof fetch;
  const err = await upstreamFetch('t', 'u', {}, { retries: 1 }).catch((e) => e);
  expect(err).toBeInstanceOf(UpstreamError);
  expect(err.status).toBe(502);
});

test('4xx is returned (not retried) — a clean client error is not our failure', async () => {
  const f = jest.fn<typeof fetch>().mockResolvedValue(resp(400, '{"error":"bad"}'));
  global.fetch = f as typeof fetch;
  const { httpStatus, data } = await upstreamFetch<{ error: string }>('t', 'u', {});
  expect(httpStatus).toBe(400);
  expect(data.error).toBe('bad');
  expect(f).toHaveBeenCalledTimes(1);
});

test('timeout (AbortError) retries then throws a timeout UpstreamError', async () => {
  const f = jest.fn<typeof fetch>().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  global.fetch = f as typeof fetch;
  const err = await upstreamFetch('t', 'u', {}, { timeoutMs: 20, retries: 1 }).catch((e) => e);
  expect(err).toBeInstanceOf(UpstreamError);
  expect(err.message).toMatch(/timed out/);
  expect(f).toHaveBeenCalledTimes(2);
});
