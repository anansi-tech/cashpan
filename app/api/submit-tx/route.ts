import { NextResponse } from 'next/server';
import { Transaction } from '@mysten/sui/transactions';
import { graphqlClient } from '@/lib/graphql';
import { getAuthedSub } from '@/lib/session';
import { getActiveVault } from '@/lib/db/vault-registry';
import { suiNetwork } from '@/lib/sui';
import { enforceRateLimit } from '@/lib/rate-limit';
import { normalizeSuiAddress } from '@/lib/sponsor-guard';
import { UpstreamError } from '@/lib/upstream-fetch';

export const dynamic = 'force-dynamic';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new UpstreamError(`${label}: timed out after ${ms}ms`)), ms)),
  ]);
}

const RETRY_DELAYS_MS = [300, 800]; // mirror gqlPost: 2 retries

// Resubmitting identical signed bytes is idempotent on Sui (same digest → same
// effects), so 429/timeout/network errors are safe to retry. Move failures come
// back as a returned {$kind:'FailedTransaction'} (not a throw) and are NOT retried.
async function executeWithRetry(transaction: Uint8Array, signatures: string[]) {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const m = String((lastErr as Error)?.message ?? '').match(/retry-after[:\s]+(\d+)/i);
      const retryAfterMs = m ? Number(m[1]) * 1000 : 0;
      await new Promise((r) => setTimeout(r, Math.max(RETRY_DELAYS_MS[attempt - 1], retryAfterMs)));
    }
    try {
      return await withTimeout(
        graphqlClient().executeTransaction({ transaction, signatures, include: { objectTypes: true } }),
        20_000,
        'submit-tx execute',
      );
    } catch (err) {
      lastErr = err;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : 'submit failed after retries';
  throw new UpstreamError(`submit-tx: ${msg}`);
}

export async function POST(req: Request) {
  const sub = getAuthedSub(req);
  if (!sub) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const limited = await enforceRateLimit(req, 'submit', 30, 60_000);
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
    // Retries on 429/timeout/network (idempotent resubmit); fails to a clean 502.
    const result = await executeWithRetry(transaction, signatures);

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
    if (err instanceof UpstreamError) {
      console.error('[/api/submit-tx] upstream:', err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[/api/submit-tx] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
