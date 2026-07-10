/**
 * POST /api/onramp/session — mint a Coinbase Onramp URL for the signed-in user.
 *
 * Card/ACH/Apple Pay → native USDC on Sui → the user's own zkLogin wallet.
 * The destination address is ALWAYS derived from the authenticated session
 * server-side — never accepted from the client. Zero custody surface: Coinbase
 * delivers to the user's address; nothing here touches funds or signs.
 *
 * CDP v2 Onramp Sessions API (verified live 2026-07-10): returns a single-use
 * hosted URL (https://pay.coinbase.com/buy?sessionToken=…). Session tokens are
 * mandatory and expire in 5 minutes — mint one per tap.
 *
 * offramp: same CDP integration family (POST /platform/v2/offramp equivalents,
 * pay.coinbase.com/v3/sell) — "Cash out" is a fast-follow, not built yet.
 */

import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { generateJwt } from '@coinbase/cdp-sdk/auth';
import { getActiveVault } from '@/lib/db/vault-registry';
import { suiNetwork } from '@/lib/sui';
import { resolveClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';

const CDP_HOST = 'api.cdp.coinbase.com';
const CDP_PATH = '/platform/v2/onramp/sessions';

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sub = cookieStore.get('cashpan-sub')?.value;
  if (!sub) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const apiKeyId = process.env.CDP_API_KEY;
  const apiKeySecret = process.env.CDP_API_SECRET;
  if (!apiKeyId || !apiKeySecret) {
    return NextResponse.json({ error: 'Onramp not configured' }, { status: 503 });
  }

  const vault = await getActiveVault(sub, suiNetwork());
  if (!vault) return NextResponse.json({ error: 'Vault not found' }, { status: 404 });

  const { presetFiatAmount } = await req.json().catch(() => ({})) as { presetFiatAmount?: number };

  try {
    const jwt = await generateJwt({
      apiKeyId,
      apiKeySecret,
      requestMethod: 'POST',
      requestHost: CDP_HOST,
      requestPath: CDP_PATH,
    });

    // First public hop of x-forwarded-for / x-real-ip binds the session to the
    // user (recommended by CDP). The field is optional and CDP 400s on private
    // IPs, so in local dev (loopback/LAN) it is omitted entirely.
    const hdrs = await headers();
    const clientIp = resolveClientIp((n) => hdrs.get(n));
    if (process.env.DEBUG) console.log('[/api/onramp/session] clientIp:', clientIp ?? '(omitted — private/unknown)');

    // Brings the user back after the mobile redirect flow. Silently ignored by
    // Coinbase until the domain is allowlisted in CDP Portal → Onramp settings.
    const host = hdrs.get('host');
    const redirectUrl = host ? `https://${host}/` : undefined;

    const res = await fetch(`https://${CDP_HOST}${CDP_PATH}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        destinationAddress: vault.payoutAddress, // server-derived, never client-supplied
        purchaseCurrency: 'USDC',
        destinationNetwork: 'sui',
        ...(clientIp ? { clientIp } : {}),
        ...(redirectUrl ? { redirectUrl } : {}),
      }),
    });

    const data = await res.json().catch(() => ({})) as {
      session?: { onrampUrl?: string };
      errorMessage?: string;
      message?: string;
    };

    if (!res.ok || !data.session?.onrampUrl) {
      const msg = data.errorMessage ?? data.message ?? `Onramp session failed (HTTP ${res.status})`;
      console.error('[/api/onramp/session] CDP error:', res.status, JSON.stringify(data).slice(0, 400));
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    // Preset amount rides as documented URL params — avoids the v2 quoting
    // requirements (paymentMethod + country + subdivision) we don't need.
    const url = new URL(data.session.onrampUrl);
    if (presetFiatAmount && presetFiatAmount > 0) {
      url.searchParams.set('presetFiatAmount', String(presetFiatAmount));
      url.searchParams.set('fiatCurrency', 'USD');
    }

    return NextResponse.json({ url: url.toString() });
  } catch (err) {
    console.error('[/api/onramp/session]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
