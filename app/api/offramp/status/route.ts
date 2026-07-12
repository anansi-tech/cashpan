/**
 * GET /api/offramp/status — proxy Coinbase's offramp transaction status.
 *
 * The partnerUserRef is derived server-side from the session (the client
 * never sees or supplies it). Returns the newest transaction's essentials;
 * the CashOutCard polls this with backoff after the widget returns.
 *
 * Field mapping is defensive — tx-level field names are validated by the
 * first real cash-out (raw tx logged behind DEBUG to adjust quickly).
 */

import { NextResponse } from 'next/server';
import { getActiveVault, addOfframpAddress } from '@/lib/db/vault-registry';
import { getAuthedSub } from '@/lib/session';
import { suiNetwork } from '@/lib/sui';
import { partnerUserRef, cdpFetch } from '@/lib/offramp-server';

export const dynamic = 'force-dynamic';

type RawTx = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export async function GET(req: Request) {
  const sub = getAuthedSub(req);
  if (!sub) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const vault = await getActiveVault(sub, suiNetwork());
  if (!vault) return NextResponse.json({ error: 'Vault not found' }, { status: 404 });

  try {
    const ref = partnerUserRef(vault.identityKey);
    const res = await cdpFetch('GET', `/onramp/v1/sell/user/${ref}/transactions`);
    const data = await res.json().catch(() => ({})) as { transactions?: RawTx[]; message?: string };

    if (!res.ok) {
      const msg = data.message ?? `Status lookup failed (HTTP ${res.status})`;
      console.error('[/api/offramp/status] CDP error:', res.status, JSON.stringify(data).slice(0, 300));
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const txs = data.transactions ?? [];
    if (txs.length === 0) return NextResponse.json({ transaction: null });

    // Don't trust list ordering — pick the newest by created_at explicitly.
    const tx = [...txs].sort((a, b) =>
      new Date(String(b.created_at ?? 0)).getTime() - new Date(String(a.created_at ?? 0)).getTime(),
    )[0];
    if (process.env.DEBUG) console.log('[/api/offramp/status] raw tx:', JSON.stringify(tx).slice(0, 600));

    const sellAmount = tx.sell_amount as { value?: string; currency?: string } | undefined;
    const total = tx.total as { value?: string; currency?: string } | undefined;
    const toAddress = str(tx.to_address) ?? str(tx.toAddress) ?? str(tx.deposit_address);

    // Persist the Coinbase deposit address so the on-chain send gets labeled
    // "Coinbase (cash out)" in activity — an off-chain label on a real ledger
    // event, never a fabricated event.
    if (toAddress) await addOfframpAddress(vault.identityKey, toAddress).catch(() => {});

    return NextResponse.json({
      transaction: {
        status: str(tx.status) ?? 'UNKNOWN',
        sellAmount: str(sellAmount?.value),
        currency: str(sellAmount?.currency) ?? str(tx.asset) ?? 'USDC',
        fiatAmount: str(total?.value),
        fiatCurrency: str(total?.currency) ?? 'USD',
        paymentMethod: str(tx.payment_method) ?? str(tx.paymentMethod),
        asset: str(tx.asset) ?? 'USDC',
        network: str(tx.network) ?? 'sui',
        toAddress,
        // Set once Coinbase has DETECTED the user's on-chain deposit —
        // drives the "Coinbase received → selling" progressive state.
        txHash: str(tx.tx_hash),
        createdAt: str(tx.created_at),
        updatedAt: str(tx.updated_at),
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[/api/offramp/status]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
