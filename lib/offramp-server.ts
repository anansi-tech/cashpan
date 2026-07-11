/**
 * Coinbase Offramp — server helpers (JWT, partnerUserRef, availability cache).
 *
 * Same CDP family as onramp but the flow inverts: Coinbase tells US where to
 * send; the user signs an on-chain send; Coinbase pays out fiat to their bank.
 */

import { createHash } from 'crypto';
import { generateJwt } from '@coinbase/cdp-sdk/auth';

const CDP_HOST = 'api.developer.coinbase.com';

/**
 * Stable per-user reference for Coinbase status lookups. Never the raw Google
 * sub (it would leak identity in URL params) — a one-way hash, <50 chars.
 */
export function partnerUserRef(identityKey: string): string {
  return `cp_${createHash('sha256').update(identityKey).digest('hex').slice(0, 40)}`;
}

export async function cdpFetch(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
  // The JWT uri claim is signed over the BARE path — including the query
  // string breaks signature validation (401 → empty payloads downstream).
  const signPath = path.split('?')[0];
  const jwt = await generateJwt({
    apiKeyId: process.env.CDP_API_KEY!,
    apiKeySecret: process.env.CDP_API_SECRET!,
    requestMethod: method,
    requestHost: CDP_HOST,
    requestPath: signPath,
  });
  return fetch(`https://${CDP_HOST}${path}`, {
    method,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// ─── Sell availability by US subdivision (24h cache) ─────────────────────────
//
// The region header is a HINT for UI copy only — never a gate. Coinbase's own
// flow is the authority on eligibility (they know verified residence; we know
// an IP). Sell-options data is stable, so 24h per subdivision is plenty.

interface AvailabilityCache {
  bySubdivision: Map<string, { suiSellable: boolean; ts: number }>;
}

const g = globalThis as typeof globalThis & { _offrampAvailability?: AvailabilityCache };
const TTL_MS = 24 * 60 * 60 * 1000;

export async function isSuiSellableInRegion(subdivision: string | undefined): Promise<boolean> {
  const key = subdivision?.toUpperCase() ?? 'US';
  g._offrampAvailability ??= { bySubdivision: new Map() };
  const cached = g._offrampAvailability.bySubdivision.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.suiSellable;

  const qs = subdivision ? `country=US&subdivision=${encodeURIComponent(key)}` : 'country=US';
  const res = await cdpFetch('GET', `/onramp/v1/sell/options?${qs}`);
  const data = await res.json().catch(() => ({})) as {
    sell_currencies?: Array<{ id?: string; code?: string; symbol?: string; name?: string; networks?: Array<{ name?: string }> }>;
  };
  const usdc = (data.sell_currencies ?? []).find((c) => [c.id, c.code, c.symbol, c.name].includes('USDC'));
  const suiSellable = (usdc?.networks ?? []).some((n) => n.name === 'sui');

  g._offrampAvailability.bySubdivision.set(key, { suiSellable, ts: Date.now() });
  return suiSellable;
}
