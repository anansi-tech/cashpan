import { NextResponse } from 'next/server';
import { getAgentActivity } from '@/lib/read-layer';
import { resolveVault } from '@/lib/resolve-vault';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get('limit') ?? '20'), 100);
  const vault = await resolveVault(request);
  const data = await getAgentActivity(limit, vault.vaultId);
  return NextResponse.json(data);
}
