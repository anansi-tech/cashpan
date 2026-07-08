import { NextResponse } from 'next/server';
import { resolveVault } from '@/lib/resolve-vault';
import { updateSavingsPrincipal } from '@/lib/db/vault-registry';
import { humanToBase } from '@/lib/coin-config';

export async function POST(req: Request): Promise<Response> {
  try {
    const vault = await resolveVault(req);
    const { direction, amountSui, savingsSui } = await req.clone().json() as {
      direction: 'sweep' | 'topup';
      amountSui: string;
      savingsSui?: string;
    };

    const amount = humanToBase(amountSui);
    if (amount <= 0n) return NextResponse.json({ ok: true });

    const current = BigInt(vault.savingsPrincipal ?? '0');

    let next: bigint;
    if (direction === 'sweep') {
      next = current + amount;
    } else {
      // Proportional reduction using pre-topup savings value supplied by client.
      // valueBeforeWithdraw = savingsSui (pre-tx) converted to base.
      const valueBeforeWithdraw = savingsSui ? humanToBase(savingsSui) : 0n;
      if (valueBeforeWithdraw > 0n) {
        const reduction = (current * amount) / valueBeforeWithdraw;
        next = current > reduction ? current - reduction : 0n;
        // Clamp: basis can never exceed post-tx savings (rounding dust guard).
        const postTxSavings = valueBeforeWithdraw - amount;
        if (postTxSavings >= 0n && next > postTxSavings) next = postTxSavings;
      } else {
        next = 0n;
      }
    }

    await updateSavingsPrincipal(vault.identityKey, next);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[principal-update]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
