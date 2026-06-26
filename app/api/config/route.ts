import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/read-layer';
import { resolveVault } from '@/lib/resolve-vault';

export async function GET(req: Request) {
  const vault = await resolveVault(req);
  const data = await getConfig(vault.vaultId);
  return NextResponse.json(data);
}
