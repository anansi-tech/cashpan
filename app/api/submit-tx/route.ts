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
    const effects = r.effects as { status?: { status?: string; error?: string } } | undefined;
    if (!digest) {
      const raw = JSON.stringify(r).slice(0, 500);
      console.error('[/api/submit-tx] executeTransaction returned no digest. Raw:', raw);
      throw new Error(`Transaction executed but returned no digest. Raw: ${raw}`);
    }
    if (effects?.status?.status && effects.status.status !== 'success') {
      console.error('[/api/submit-tx] transaction failed:', digest, JSON.stringify(effects.status));
    }
    return NextResponse.json({ digest, effects });
  } catch (err) {
    console.error('[/api/submit-tx] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
