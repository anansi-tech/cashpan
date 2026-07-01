/**
 * resolveVault(req) — THE single auth seam.
 */

import { getByIdentity, type VaultRecord } from './db/vault-registry';
import { suiNetwork } from './sui';

export type { VaultRecord };

export async function resolveVault(req: Request): Promise<VaultRecord> {
  const cookie = req.headers.get('cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)cashpan-sub=([^;]+)/);
  const sub = match ? decodeURIComponent(match[1]) : null;

  if (!sub) throw new Error('Not authenticated');

  const vault = await getByIdentity(sub, suiNetwork());
  if (!vault) throw new Error('No vault found for this account');
  return vault;
}
