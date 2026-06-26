import { NextResponse } from 'next/server';
import { getBalances } from '@/lib/read-layer';
import { resolveVault } from '@/lib/resolve-vault';

export async function GET(req: Request) {
  const vault = await resolveVault(req);
  const data = await getBalances(vault.vaultId);
  return NextResponse.json(data);
}
