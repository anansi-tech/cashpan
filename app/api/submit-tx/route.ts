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
    return NextResponse.json({ digest: (result as { digest?: string }).digest ?? '' });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
