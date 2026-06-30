import { NextResponse } from 'next/server';
import { resolveVault } from '@/lib/resolve-vault';
import { computeReadTimeProposals } from '@/lib/brain';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  try {
    const vault = await resolveVault(req);
    const proposals = await computeReadTimeProposals(
      vault.payoutAddress,
      vault.vaultId,
      vault.coinType,
    );
    return NextResponse.json(proposals);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('Not authenticated') || msg.includes('No vault found')) {
      return NextResponse.json([], { status: 200 }); // unauthenticated → empty, no banner
    }
    console.error('[/api/proposals]', msg);
    return NextResponse.json([], { status: 200 }); // errors degrade gracefully
  }
}
