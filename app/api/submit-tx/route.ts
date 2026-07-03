import { NextResponse } from 'next/server';
import { graphqlClient } from '@/lib/graphql';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { txBytes, signatures } = await req.json() as { txBytes: string; signatures: string[] };
    const transaction = Uint8Array.from(atob(txBytes), (c) => c.charCodeAt(0));
    const result = await graphqlClient().executeTransaction({
      transaction,
      signatures,
      include: { effects: true, events: true, balanceChanges: true },
    });
    const r = result as Record<string, unknown>;
    const digest: string =
      (typeof r.digest === 'string' ? r.digest : null) ??
      (typeof (r.transaction as { digest?: string } | undefined)?.digest === 'string'
        ? (r.transaction as { digest: string }).digest
        : null) ??
      (typeof (r.effects as { transactionDigest?: string } | undefined)?.transactionDigest === 'string'
        ? (r.effects as { transactionDigest: string }).transactionDigest
        : '') ??
      '';
    return NextResponse.json({ digest });
  } catch (err) {
    console.error('[/api/submit-tx] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
