import { NextResponse } from 'next/server';
import { Transaction } from '@mysten/sui/transactions';
import { graphqlClient } from '@/lib/graphql';
import { getAuthedSub } from '@/lib/session';
import { getActiveVault } from '@/lib/db/vault-registry';
import { suiNetwork } from '@/lib/sui';
import { enforceRateLimit } from '@/lib/rate-limit';
import { normalizeSuiAddress } from '@/lib/sponsor-guard';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const sub = getAuthedSub(req);
  if (!sub) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const limited = enforceRateLimit(req, 'submit', 30, 60_000);
  if (limited) return limited;

  try {
    const { txBytes, signatures } = await req.json() as { txBytes: string; signatures: string[] };
    const transaction = Uint8Array.from(atob(txBytes), (c) => c.charCodeAt(0));

    // The signed bytes carry the sender. Assert it's the caller's own vault
    // wallet — you may only submit your own transactions. create_vault runs
    // before a vault row exists (provisioning), so no-vault is allowed through.
    const vault = await getActiveVault(sub, suiNetwork());
    if (vault) {
      let sender = '';
      try { sender = Transaction.from(transaction).getData().sender ?? ''; } catch { /* fall through */ }
      if (normalizeSuiAddress(sender) !== normalizeSuiAddress(vault.payoutAddress)) {
        return NextResponse.json({ error: 'Sender is not your vault wallet' }, { status: 403 });
      }
    }

    // SDK returns a discriminated union: {$kind:'Transaction',...} or {$kind:'FailedTransaction',...}
    const result = await graphqlClient().executeTransaction({ transaction, signatures, include: { objectTypes: true } });

    const txData = result.Transaction ?? result.FailedTransaction;
    const digest = txData?.digest ?? '';

    if (!digest) {
      const raw = JSON.stringify(result).slice(0, 500);
      console.error('[/api/submit-tx] no digest in result. Raw:', raw);
      throw new Error(`Transaction executed but returned no digest. Raw: ${raw}`);
    }

    if (result.$kind === 'FailedTransaction') {
      const err = result.FailedTransaction?.status.error as { message?: string } | null;
      const errorMsg = err?.message ?? 'Transaction failed';
      console.error('[/api/submit-tx] transaction failed:', digest, errorMsg);
      return NextResponse.json({ digest, error: errorMsg }, { status: 400 });
    }

    return NextResponse.json({ digest, objectTypes: result.Transaction?.objectTypes ?? {} });
  } catch (err) {
    console.error('[/api/submit-tx] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
