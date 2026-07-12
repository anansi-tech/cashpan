/**
 * POST /api/propose — proposal computation for the manual Move form.
 *
 * The form and chat are two front doors to ONE pipeline: this route calls the
 * same lib/propose functions the chat tools call, returns the same Proposal
 * shape, and the client renders the same ConfirmCard → sign path. No parallel
 * execution route exists.
 */

import { NextResponse } from 'next/server';
import { proposeSweep, proposeTopup, proposeWithdrawToMe } from '@/lib/propose';
import { resolveVault } from '@/lib/resolve-vault';

export const dynamic = 'force-dynamic';

const MIN_MOVE = 0.01; // dust floor, mirrors lib/brain.ts MIN_MOVE

export async function POST(req: Request) {
  try {
    const vault = await resolveVault(req.clone()).catch(() => null);
    if (!vault) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const { action, amount, max } = await req.json() as {
      action?: 'sweep' | 'topup' | 'withdrawToMe';
      amount?: string;
      max?: boolean;
    };

    if (action !== 'sweep' && action !== 'topup' && action !== 'withdrawToMe') {
      return NextResponse.json({ error: 'action must be sweep, topup, or withdrawToMe' }, { status: 400 });
    }
    if (!max) {
      const n = parseFloat(amount ?? '');
      if (!isFinite(n) || n <= 0) return NextResponse.json({ error: 'Enter an amount' }, { status: 400 });
      if (n < MIN_MOVE) return NextResponse.json({ error: `Minimum move is $${MIN_MOVE.toFixed(2)}` }, { status: 400 });
    }

    // Max maps to the exact-everything paths: full-liquid sweep/withdraw, or
    // the drain (full redeem) for Save → Spend — never a computed number.
    const proposal = action === 'sweep'
      ? await proposeSweep(max ? undefined : amount, vault.vaultId)
      : action === 'withdrawToMe'
        ? await proposeWithdrawToMe(max ? undefined : amount, vault.vaultId)
        : await proposeTopup(max ? undefined : amount, vault.vaultId);

    return NextResponse.json({ proposal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Proposal failed';
    const status = msg.includes('authenticated') || msg.includes('vault') ? 401 : 500;
    console.error('[/api/propose]', msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
