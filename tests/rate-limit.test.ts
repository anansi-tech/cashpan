/**
 * Rate limiter. Async interface (memory fallback or global Upstash backend).
 * Tests exercise the in-memory backend (no KV env in jest → memory selected).
 */

import { rateLimiter, clientKey, enforceRateLimit, isGlobalRateLimit } from '../lib/rate-limit.js';

const req = (ip: string) => new Request('http://x/api', { headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` } });

describe('backend selection', () => {
  test('no KV env → memory (per-instance) backend', () => {
    expect(isGlobalRateLimit()).toBe(false);
  });
});

describe('rateLimiter (async)', () => {
  test('allows up to the limit, then blocks', async () => {
    const key = `t1:${Math.random()}`;
    for (let i = 0; i < 5; i++) expect((await rateLimiter.check(key, 5, 60_000)).ok).toBe(true);
    const blocked = await rateLimiter.check(key, 5, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterS).toBeGreaterThan(0);
  });

  test('separate keys are independent', async () => {
    const a = `t2a:${Math.random()}`, b = `t2b:${Math.random()}`;
    for (let i = 0; i < 5; i++) await rateLimiter.check(a, 5, 60_000);
    expect((await rateLimiter.check(a, 5, 60_000)).ok).toBe(false);
    expect((await rateLimiter.check(b, 5, 60_000)).ok).toBe(true);
  });

  test('window slides — old hits expire', async () => {
    const key = `t3:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect((await rateLimiter.check(key, 3, 30)).ok).toBe(true);
    expect((await rateLimiter.check(key, 3, 30)).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 45));
    expect((await rateLimiter.check(key, 3, 30)).ok).toBe(true);
  });
});

describe('clientKey', () => {
  test('uses the first x-forwarded-for hop, namespaced by bucket', () => {
    expect(clientKey(req('203.0.113.9'), 'sponsor')).toBe('sponsor:203.0.113.9');
  });
  test('falls back to "unknown" with no headers', () => {
    expect(clientKey(new Request('http://x/api'), 'salt')).toBe('salt:unknown');
  });
});

describe('enforceRateLimit', () => {
  test('resolves null while under limit, a 429 with Retry-After when over', async () => {
    const ip = `ip-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(await enforceRateLimit(req(ip), 'b', 3, 60_000)).toBeNull();
    const res = await enforceRateLimit(req(ip), 'b', 3, 60_000);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(Number(res!.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});
