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

import { getActiveVault, type VaultRecord } from './db/vault-registry';

export type { VaultRecord };

/**
 * Block 1: extracts identityKey from ?user= param or x-cashpan-user header.
 * Block 2: swap body to extract sub from zkLogin session — signature unchanged.
 */
export async function resolveVault(req: Request): Promise<VaultRecord> {
  const url = new URL(req.url);
  // Priority: ?user= param → x-cashpan-user header → cashpan-user cookie
  const identityKey =
    url.searchParams.get('user') ??
    req.headers.get('x-cashpan-user') ??
    parseCashpanUserCookie(req.headers.get('cookie')) ??
    undefined;
  const vault = await getActiveVault(identityKey);
  if (!vault) throw new Error('No vault registered. Run: npm run create-vault -- --identity <key>');
  return vault;
}

function parseCashpanUserCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)cashpan-user=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
