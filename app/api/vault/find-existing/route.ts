import { NextResponse } from 'next/server';
import { findOwnedOwnerCap } from '@/lib/graphql';

export const dynamic = 'force-dynamic';

// GET /api/vault/find-existing?address=...&packageId=...
// Returns { found: true, vaultId, ownerCapId } or { found: false }
// Used by ProvisionVault to detect orphaned on-chain vaults before creating another.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address');
  const packageId = searchParams.get('packageId');
  if (!address || !packageId) {
    return NextResponse.json({ error: 'address and packageId required' }, { status: 400 });
  }
  try {
    const found = await findOwnedOwnerCap(address, packageId);
    if (!found) return NextResponse.json({ found: false });
    return NextResponse.json({ found: true, vaultId: found.vaultId, ownerCapId: found.ownerCapId });
  } catch (err) {
    console.error('[/api/vault/find-existing]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
