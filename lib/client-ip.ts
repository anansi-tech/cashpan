/**
 * Resolve the real client IP from proxy headers, or undefined when it can't
 * be trusted/used. CDP's onramp session API rejects private/loopback IPs
 * (HTTP 400 "private IP addresses are not allowed" in local dev) — the field
 * is optional, so we omit it rather than send a private address.
 */

const PRIVATE_V4 = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
];

export function isPrivateIp(ip: string): boolean {
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) — judge the v4 part.
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (PRIVATE_V4.some((re) => re.test(v4))) return true;
  const lower = ip.toLowerCase();
  return (
    lower === '::1' ||                 // loopback
    lower.startsWith('fc') ||          // unique-local fc00::/7
    lower.startsWith('fd') ||
    lower.startsWith('fe80')           // link-local
  );
}

/** First public hop from x-forwarded-for / x-real-ip, else undefined. */
export function resolveClientIp(get: (name: string) => string | null): string | undefined {
  const ip = get('x-forwarded-for')?.split(',')[0]?.trim() || get('x-real-ip')?.trim() || '';
  if (!ip || isPrivateIp(ip)) return undefined;
  return ip;
}
