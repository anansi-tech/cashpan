/**
 * POST /api/offramp/session — mint a Coinbase Offramp (sell) URL.
 *
 * v1 session token (single-use, 5-min expiry) bound to the USER'S zkLogin
 * address — the address that will hold and send the funds being sold. Always
 * server-derived from the authenticated session, never client-supplied.
 *
 * The user picks the amount in Coinbase's widget, not here. After they click
 * "Cash out now", the status API tells us amount + deposit address, and the
 * CashOutCard has them sign the on-chain send (ask-me pattern).
 */

import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { getActiveVault } from '@/lib/db/vault-registry';
import { suiNetwork } from '@/lib/sui';
import { resolveClientIp } from '@/lib/client-ip';
import { partnerUserRef, cdpFetch } from '@/lib/offramp-server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sub = cookieStore.get('cashpan-sub')?.value;
  if (!sub) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  if (!process.env.CDP_API_KEY || !process.env.CDP_API_SECRET) {
    return NextResponse.json({ error: 'Cash out not configured' }, { status: 503 });
  }

  const vault = await getActiveVault(sub, suiNetwork());
  if (!vault) return NextResponse.json({ error: 'Vault not found' }, { status: 404 });

  try {
    const { presetCryptoAmount } = await req.json().catch(() => ({})) as { presetCryptoAmount?: string };
    const hdrs = await headers();
    const clientIp = resolveClientIp((n) => hdrs.get(n));

    const res = await cdpFetch('POST', '/onramp/v1/token', {
      addresses: [{ address: vault.payoutAddress, blockchains: ['sui'] }],
      assets: ['USDC'],
      ...(clientIp ? { clientIp } : {}),
    });
    const data = await res.json().catch(() => ({})) as { token?: string; message?: string; errorMessage?: string };

    if (!res.ok || !data.token) {
      // Amendment rule: Coinbase is the eligibility authority — surface their
      // reason verbatim so the UI can show it in a clean card.
      const msg = data.errorMessage ?? data.message ?? `Cash out session failed (HTTP ${res.status})`;
      console.error('[/api/offramp/session] CDP error:', res.status, JSON.stringify(data).slice(0, 400));
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const host = hdrs.get('host');
    const proto = hdrs.get('x-forwarded-proto') ?? 'http';
    const origin = appUrl ? appUrl.replace(/\/$/, '') : host ? `${proto}://${host}` : undefined;

    const url = new URL('https://pay.coinbase.com/v3/sell/input');
    url.searchParams.set('sessionToken', data.token);
    url.searchParams.set('partnerUserRef', partnerUserRef(vault.identityKey));
    if (presetCryptoAmount && Number(presetCryptoAmount) > 0) {
      url.searchParams.set('presetCryptoAmount', presetCryptoAmount);
    }
    if (origin) url.searchParams.set('redirectUrl', `${origin}/onramp/callback`);

    return NextResponse.json({ url: url.toString() });
  } catch (err) {
    console.error('[/api/offramp/session]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
