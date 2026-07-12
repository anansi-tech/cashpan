import { NextResponse } from 'next/server';
import { getAgentActivity } from '@/lib/read-layer';
import { resolveVault } from '@/lib/resolve-vault';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get('limit') ?? '20'), 100);
  const vault = await resolveVault(request).catch(() => null);
  if (!vault) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const addressToName = Object.fromEntries(
    (vault.contacts ?? []).map((c) => [c.address.toLowerCase(), c.label]),
  );
  const data = await getAgentActivity(limit, vault.vaultId, addressToName);
  return NextResponse.json(data);
}
