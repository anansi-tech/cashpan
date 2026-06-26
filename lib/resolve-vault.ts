/**
 * resolveVault(req) — THE single auth seam.
 *
 * Block 1: dev selector (x-cashpan-user header or ?user= param).
 *          Falls back to first registered vault (single-user compat).
 * Block 2: swap body for zkLogin session → sub → registry lookup.
 *          Nothing else in the app changes.
 *
 * Every API route that touches a vault calls this and nothing else.
 * If adding zkLogin requires touching any other file, Block 1 was wrong.
 */

import { getActiveVault, type VaultRecord } from './db/vault-registry.js';

export type { VaultRecord };

export async function resolveVault(req: Request): Promise<VaultRecord> {
  const vault = await getActiveVault(req);
  if (!vault) throw new Error('No vault registered. Run: npm run create-vault -- --identity <key>');
  return vault;
}
