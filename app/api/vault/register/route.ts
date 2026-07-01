/**
 * POST /api/vault/register
 * Called by ProvisionVault after the user signs the create_vault tx.
 * Reads cashpan-sub cookie to bind the vault to the authenticated user.
 */

import { NextResponse } from 'next/server';
import { registerVault } from '@/lib/db/vault-registry';
import { suiNetwork } from '@/lib/sui';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // Verify the request comes from the authenticated user
  const sub = req.headers.get('cookie')?.match(/(?:^|;\s*)cashpan-sub=([^;]+)/)?.[1];
  if (!sub) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { vaultId, ownerCapId, payoutAddress, salt, coinType } =
    await req.json() as {
      vaultId: string;
      ownerCapId: string;
      payoutAddress: string;
      salt: string;
      coinType: string;
    };

  if (!vaultId || !ownerCapId || !payoutAddress || !coinType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const vault = await registerVault({
      identityKey: decodeURIComponent(sub),
      network: suiNetwork(),
      vaultId,
      ownerCapId,
      payoutAddress,
      salt,
      coinType,
    });
    return NextResponse.json({ ok: true, vaultId: vault.vaultId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
