import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/read-layer';
import { resolveVault } from '@/lib/resolve-vault';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const vault = await resolveVault(req).catch(() => null);
  if (!vault) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const data = await getConfig(vault.vaultId);
  return NextResponse.json(data);
}
