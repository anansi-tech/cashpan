/**
 * resolveVault(req) — THE single auth seam.
 *
 * Block 2: reads cashpan-sub HTTP-only cookie (set by /api/auth/session
 *          after Google OAuth) → looks up vault by sub in the registry.
 * Block 3+: swap body only — nothing else in the app changes.
 */

import { getByIdentity, type VaultRecord } from './db/vault-registry';

export type { VaultRecord };

export async function resolveVault(req: Request): Promise<VaultRecord> {
  const cookie = req.headers.get('cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)cashpan-sub=([^;]+)/);
  const sub = match ? decodeURIComponent(match[1]) : null;

  if (!sub) throw new Error('Not authenticated');

  const vault = await getByIdentity(sub);
  if (!vault) throw new Error('No vault found for this account');
  return vault;
}
