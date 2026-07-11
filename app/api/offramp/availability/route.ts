/**
 * GET /api/offramp/availability — UI HINT only, never a gate.
 *
 * Uses the platform geo header to guess the user's state and the 24h-cached
 * sell-options data to say whether USDC-on-sui is sellable there. The UI shows
 * an inline "may not be available in <state>" note when the hint is negative —
 * the user can still proceed; Coinbase's own flow is the eligibility authority
 * (they know verified residence, we only know an IP).
 */

import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { isSuiSellableInRegion } from '@/lib/offramp-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!process.env.CDP_API_KEY || !process.env.CDP_API_SECRET) {
    return NextResponse.json({ configured: false, hint: true, region: null });
  }
  try {
    const hdrs = await headers();
    const country = hdrs.get('x-vercel-ip-country');
    const region = hdrs.get('x-vercel-ip-country-region');
    // Non-US or unknown location: no useful hint — let Coinbase decide.
    if (country && country !== 'US') return NextResponse.json({ configured: true, hint: true, region: null });

    const hint = await isSuiSellableInRegion(region ?? undefined);
    return NextResponse.json({ configured: true, hint, region: region ?? null });
  } catch (err) {
    console.error('[/api/offramp/availability]', err);
    // Hint endpoint must never block the flow — default to available.
    return NextResponse.json({ configured: true, hint: true, region: null });
  }
}
