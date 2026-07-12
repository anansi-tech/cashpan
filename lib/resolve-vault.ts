/**
 * resolveVault(req) — THE single auth seam.
 * Session verification lives in lib/session.ts (signed cookie, HMAC).
 */

import { getByIdentity, type VaultRecord } from './db/vault-registry';
import { suiNetwork } from './sui';
import { getAuthedSub } from './session';

export type { VaultRecord };

export async function resolveVault(req: Request): Promise<VaultRecord> {
  const sub = getAuthedSub(req); // signature-verified — forged cookies are null
  if (!sub) throw new Error('Not authenticated');

  const vault = await getByIdentity(sub, suiNetwork());
  if (!vault) throw new Error('No vault found for this account');
  return vault;
}
