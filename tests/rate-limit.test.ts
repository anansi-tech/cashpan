/**
 * In-memory sliding-window rate limiter. Per-instance (advisory on serverless),
 * but must bound a single abusive instance correctly.
 */

import { rateLimiter, clientKey, enforceRateLimit } from '../lib/rate-limit.js';

const req = (ip: string) => new Request('http://x/api', { headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` } });

describe('rateLimiter', () => {
  test('allows up to the limit, then blocks', () => {
    const key = `t1:${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(rateLimiter.check(key, 5, 60_000).ok).toBe(true);
    const blocked = rateLimiter.check(key, 5, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterS).toBeGreaterThan(0);
  });

  test('separate keys are independent', () => {
    const a = `t2a:${Math.random()}`, b = `t2b:${Math.random()}`;
    for (let i = 0; i < 5; i++) rateLimiter.check(a, 5, 60_000);
    expect(rateLimiter.check(a, 5, 60_000).ok).toBe(false);
    expect(rateLimiter.check(b, 5, 60_000).ok).toBe(true);
  });

  test('window slides — old hits expire', () => {
    const key = `t3:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimiter.check(key, 3, 30).ok).toBe(true);
    expect(rateLimiter.check(key, 3, 30).ok).toBe(false);
    return new Promise((r) => setTimeout(r, 45)).then(() => {
      expect(rateLimiter.check(key, 3, 30).ok).toBe(true); // window passed
    });
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
  test('returns null while under limit, a 429 with Retry-After when over', () => {
    const ip = `ip-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(enforceRateLimit(req(ip), 'b', 3, 60_000)).toBeNull();
    const res = enforceRateLimit(req(ip), 'b', 3, 60_000);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(Number(res!.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});
