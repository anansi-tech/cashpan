/**
 * Signed session cookie — now seals {sub, address}. Pins the CDP finding's fix
 * (raw/forged sub cookies rejected) AND the identity-binding fix: a cookie
 * missing the authenticated address verifies to null (forces re-login), so no
 * route can fall back to a client-supplied or absent address.
 */

import { createHmac } from 'crypto';
import { sealSession, verifySessionCookie, getAuthedSub, getAuthedSession, SESSION_COOKIE } from '../lib/session.js';

beforeEach(() => {
  process.env.SESSION_SECRET = 'test-secret-0123456789abcdef';
});

const ADDR = '0x' + 'a'.repeat(64);
const reqWithCookie = (value: string | null): Request =>
  new Request('http://x/api', { headers: value === null ? {} : { cookie: `${SESSION_COOKIE}=${value}` } });

describe('seal / verify', () => {
  test('roundtrip returns {sub, address}', () => {
    expect(verifySessionCookie(sealSession('108234567890', ADDR))).toEqual({ sub: '108234567890', address: ADDR });
  });

  test('sealSession requires both sub and address', () => {
    expect(() => sealSession('', ADDR)).toThrow();
    expect(() => sealSession('alice', '')).toThrow();
  });

  test('THE finding: a raw Google sub (legacy/forged cookie) is rejected', () => {
    expect(verifySessionCookie('108234567890123456789')).toBeNull();
    expect(verifySessionCookie('victim-sub-value')).toBeNull();
  });

  test('a {sub}-only signed cookie (no address) is rejected → re-login', () => {
    // Forge a validly-SIGNED payload that lacks address, to prove verify still rejects it.
    process.env.SESSION_SECRET = 'k';
    const payload = Buffer.from(JSON.stringify({ sub: 'alice', exp: Math.floor(Date.now() / 1000) + 999 })).toString('base64url');
    const sig = createHmac('sha256', 'k').update(payload).digest('base64url');
    expect(verifySessionCookie(`${payload}.${sig}`)).toBeNull();
  });

  test('tampered payload is rejected (signature mismatch)', () => {
    const token = sealSession('alice', ADDR);
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'victim', address: ADDR, exp: Math.floor(Date.now() / 1000) + 999 })).toString('base64url');
    const sig = token.slice(token.lastIndexOf('.') + 1);
    expect(verifySessionCookie(`${forgedPayload}.${sig}`)).toBeNull();
  });

  test('tampered signature is rejected', () => {
    expect(verifySessionCookie(sealSession('alice', ADDR).slice(0, -2) + 'xx')).toBeNull();
  });

  test('expired session is rejected', () => {
    expect(verifySessionCookie(sealSession('alice', ADDR, -10))).toBeNull();
  });

  test('garbage inputs are rejected, never throw', () => {
    for (const v of ['', '.', 'a.b', 'not-base64url.!!!', null, undefined]) {
      expect(verifySessionCookie(v as string)).toBeNull();
    }
  });

  test('missing SESSION_SECRET verifies nothing (fail closed)', () => {
    const token = sealSession('alice', ADDR);
    delete process.env.SESSION_SECRET;
    expect(verifySessionCookie(token)).toBeNull();
  });

  test('token signed under a different secret is rejected (deploy-time invalidation)', () => {
    const token = sealSession('alice', ADDR);
    process.env.SESSION_SECRET = 'rotated-secret';
    expect(verifySessionCookie(token)).toBeNull();
  });
});

describe('getAuthedSession / getAuthedSub', () => {
  test('valid cookie → {sub, address}', () => {
    expect(getAuthedSession(reqWithCookie(sealSession('bob', ADDR)))).toEqual({ sub: 'bob', address: ADDR });
  });

  test('getAuthedSub returns just the sub', () => {
    expect(getAuthedSub(reqWithCookie(sealSession('bob', ADDR)))).toBe('bob');
  });

  test("CDP's exact probe: no cookie → null", () => {
    expect(getAuthedSession(reqWithCookie(null))).toBeNull();
    expect(getAuthedSub(reqWithCookie(null))).toBeNull();
  });

  test('forged raw-sub cookie → null', () => {
    expect(getAuthedSession(reqWithCookie('any-guessed-google-sub'))).toBeNull();
  });
});
