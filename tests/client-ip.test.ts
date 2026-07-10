/**
 * CDP's onramp API 400s on private client IPs ("private IP addresses are not
 * allowed"). resolveClientIp must yield the first public proxy hop, and
 * undefined (→ field omitted) for anything private/loopback/unknown.
 */

import { isPrivateIp, resolveClientIp } from '../lib/client-ip.js';

const hdrs = (map: Record<string, string>) => (name: string) => map[name] ?? null;

describe('isPrivateIp', () => {
  test.each([
    '10.0.0.1', '172.16.5.9', '172.31.255.1', '192.168.1.44', '127.0.0.1',
    '169.254.10.2', '0.0.0.0', '::1', 'fc00::1', 'fd12::8', 'fe80::abcd',
    '::ffff:192.168.0.7', '::ffff:127.0.0.1',
  ])('%s is private', (ip) => expect(isPrivateIp(ip)).toBe(true));

  test.each([
    '8.8.8.8', '172.15.0.1', '172.32.0.1', '203.0.113.9',
    '2600:1700::1', '::ffff:8.8.4.4',
  ])('%s is public', (ip) => expect(isPrivateIp(ip)).toBe(false));
});

describe('resolveClientIp', () => {
  test('first hop of x-forwarded-for when public', () => {
    expect(resolveClientIp(hdrs({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
  });

  test('falls back to x-real-ip', () => {
    expect(resolveClientIp(hdrs({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
  });

  test('local dev: loopback first hop → undefined (field omitted)', () => {
    expect(resolveClientIp(hdrs({ 'x-forwarded-for': '127.0.0.1' }))).toBeUndefined();
    expect(resolveClientIp(hdrs({ 'x-forwarded-for': '::ffff:192.168.1.20' }))).toBeUndefined();
  });

  test('no headers → undefined', () => {
    expect(resolveClientIp(hdrs({}))).toBeUndefined();
  });
});
