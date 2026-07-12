import { NextResponse } from 'next/server';
import { getAuthedSub } from '@/lib/session';
import { getActiveVault, updateSettings } from '@/lib/db/vault-registry';
import { suiNetwork } from '@/lib/sui';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const sub = getAuthedSub(req);
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const vault = await getActiveVault(sub, suiNetwork());
  if (!vault) return NextResponse.json({ error: 'Vault not found' }, { status: 404 });

  const body = await req.json() as { buffer?: string; band?: string };
  const sanitized: { buffer?: string; band?: string } = {};

  if (body.buffer !== undefined) {
    const n = parseFloat(body.buffer);
    if (isNaN(n) || n < 0) return NextResponse.json({ error: 'Invalid buffer' }, { status: 400 });
    sanitized.buffer = String(n);
  }
  if (body.band !== undefined) {
    const n = parseFloat(body.band);
    if (isNaN(n) || n < 0) return NextResponse.json({ error: 'Invalid band' }, { status: 400 });
    sanitized.band = String(n);
  }

  await updateSettings(vault.identityKey, sanitized);
  return NextResponse.json({ ok: true });
}
