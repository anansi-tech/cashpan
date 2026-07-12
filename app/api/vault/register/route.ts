/**
 * POST /api/vault/register
 * Binds the session (sub) to the vault its AUTHENTICATED address owns on-chain.
 * Client-supplied vault/ownerCap/payout are NOT trusted — everything is derived
 * from the session's Shinami-verified address, so a session can never be bound
 * to a vault the caller doesn't control.
 */

import { NextResponse } from 'next/server';
import { registerVault } from '@/lib/db/vault-registry';
import { findOwnedOwnerCap } from '@/lib/graphql';
import { getAuthedSession } from '@/lib/session';
import { suiNetwork } from '@/lib/sui';

export const dynamic = 'force-dynamic';

const PACKAGE_ID = process.env.PACKAGE_ID ?? '';
const COIN_TYPE = process.env.COIN_TYPE ?? '';

export async function POST(req: Request) {
  const session = getAuthedSession(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // The salt is the only client-supplied value we still store (opaque, per-user,
  // non-authoritative). Everything else is derived from the session address.
  const { salt } = await req.json().catch(() => ({})) as { salt?: string };

  // Find the OwnerCap the authenticated address actually owns on-chain, and the
  // vault it governs. No client IDs involved. Register runs right after the
  // client's create_vault tx, so retry a few times for GraphQL indexing lag
  // (empty result = not-yet-indexed, distinct from a query error).
  let owned: { ownerCapId: string; vaultId: string } | null = null;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 700));
      owned = await findOwnedOwnerCap(session.address, PACKAGE_ID);
      if (owned) break;
    }
  } catch (err) {
    console.error('[/api/vault/register] ownership lookup failed:', err);
    return NextResponse.json({ error: 'Could not verify vault ownership' }, { status: 502 });
  }
  if (!owned) return NextResponse.json({ error: 'No vault owned by this account' }, { status: 404 });

  try {
    const vault = await registerVault({
      identityKey: session.sub,
      network: suiNetwork(),
      vaultId: owned.vaultId,
      ownerCapId: owned.ownerCapId,
      payoutAddress: session.address,
      salt: salt ?? '',
      coinType: COIN_TYPE,
    });
    return NextResponse.json({ ok: true, vaultId: vault.vaultId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
