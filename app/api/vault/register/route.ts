/**
 * POST /api/vault/register
 * Called by ProvisionVault after the user signs the create_vault tx.
 * Binds the vault to the signature-verified session sub (lib/session.ts).
 */

import { NextResponse } from 'next/server';
import { registerVault } from '@/lib/db/vault-registry';
import { findOwnedOwnerCap } from '@/lib/graphql';
import { getAuthedSub } from '@/lib/session';
import { suiNetwork } from '@/lib/sui';
import { normalizeSuiAddress } from '@/lib/sponsor-guard';

export const dynamic = 'force-dynamic';

const PACKAGE_ID = process.env.PACKAGE_ID ?? '';

export async function POST(req: Request) {
  // Verify the request comes from the authenticated user
  const sub = getAuthedSub(req);
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

  // Ownership check: the payout address must actually own the submitted
  // OwnerCap on-chain, and it must govern the submitted vault. Blocks binding
  // a session to a cap/vault the caller doesn't control (mismatched or
  // fabricated IDs).
  try {
    const owned = await findOwnedOwnerCap(payoutAddress, PACKAGE_ID);
    if (!owned || normalizeSuiAddress(owned.ownerCapId) !== normalizeSuiAddress(ownerCapId) ||
        normalizeSuiAddress(owned.vaultId) !== normalizeSuiAddress(vaultId)) {
      return NextResponse.json({ error: 'OwnerCap not owned by this address' }, { status: 403 });
    }
  } catch (err) {
    console.error('[/api/vault/register] ownership check failed:', err);
    return NextResponse.json({ error: 'Could not verify vault ownership' }, { status: 502 });
  }

  try {
    const vault = await registerVault({
      identityKey: sub,
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
