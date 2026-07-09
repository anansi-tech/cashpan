import { NextResponse } from 'next/server';
import { graphqlClient } from '@/lib/graphql';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { txBytes, signatures } = await req.json() as { txBytes: string; signatures: string[] };
    const transaction = Uint8Array.from(atob(txBytes), (c) => c.charCodeAt(0));

    // SDK returns a discriminated union: {$kind:'Transaction',...} or {$kind:'FailedTransaction',...}
    const result = await graphqlClient().executeTransaction({
      transaction,
      signatures,
      include: { objectTypes: true },
    });

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
