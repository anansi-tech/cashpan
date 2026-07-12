/**
 * Signed session cookie — pins the CDP finding's fix. The old cookie was the
 * raw Google sub: anyone who knew/guessed a target's sub could forge it (and
 * the mint endpoint even accepted a client-claimed sub). Sessions are now
 * HMAC-sealed; forged and legacy values must verify to null everywhere.
 */

import { sealSession, verifySessionCookie, getAuthedSub, SESSION_COOKIE } from '../lib/session.js';

beforeEach(() => {
  process.env.SESSION_SECRET = 'test-secret-0123456789abcdef';
});

const reqWithCookie = (value: string | null): Request =>
  new Request('http://x/api', { headers: value === null ? {} : { cookie: `${SESSION_COOKIE}=${value}` } });

describe('seal / verify', () => {
  test('roundtrip returns the sub', () => {
    expect(verifySessionCookie(sealSession('108234567890'))).toBe('108234567890');
  });

  test('THE finding: a raw Google sub (legacy/forged cookie) is rejected', () => {
    expect(verifySessionCookie('108234567890123456789')).toBeNull();
    expect(verifySessionCookie('victim-sub-value')).toBeNull();
  });

  test('tampered payload is rejected (signature mismatch)', () => {
    const token = sealSession('alice');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'victim', exp: Math.floor(Date.now() / 1000) + 999 })).toString('base64url');
    const [, sig] = [token.slice(0, token.lastIndexOf('.')), token.slice(token.lastIndexOf('.') + 1)];
    expect(verifySessionCookie(`${forgedPayload}.${sig}`)).toBeNull();
  });

  test('tampered signature is rejected', () => {
    const token = sealSession('alice');
    expect(verifySessionCookie(token.slice(0, -2) + 'xx')).toBeNull();
  });

  test('expired session is rejected', () => {
    expect(verifySessionCookie(sealSession('alice', -10))).toBeNull();
  });

  test('garbage inputs are rejected, never throw', () => {
    for (const v of ['', '.', 'a.b', 'not-base64url.!!!', null, undefined]) {
      expect(verifySessionCookie(v as string)).toBeNull();
    }
  });

  test('missing SESSION_SECRET verifies nothing (fail closed)', () => {
    const token = sealSession('alice');
    delete process.env.SESSION_SECRET;
    expect(verifySessionCookie(token)).toBeNull();
  });

  test('token signed under a different secret is rejected (deploy-time invalidation)', () => {
    const token = sealSession('alice');
    process.env.SESSION_SECRET = 'rotated-secret';
    expect(verifySessionCookie(token)).toBeNull();
  });
});

describe('getAuthedSub (the per-route helper)', () => {
  test('valid cookie → sub', () => {
    expect(getAuthedSub(reqWithCookie(sealSession('bob')))).toBe('bob');
  });

  test("CDP's exact probe: no cookie → null (routes 401)", () => {
    expect(getAuthedSub(reqWithCookie(null))).toBeNull();
  });

  test('forged raw-sub cookie → null', () => {
    expect(getAuthedSub(reqWithCookie('any-guessed-google-sub'))).toBeNull();
  });
});
