import { NextResponse } from 'next/server';
import { resolveVault } from '@/lib/resolve-vault';
import { listContacts, addContact, removeContact, patchContact } from '@/lib/db/vault-registry';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const vault = await resolveVault(req).catch(() => null);
  if (!vault) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const contacts = await listContacts(vault.identityKey);
  return NextResponse.json(contacts);
}

export async function POST(req: Request) {
  const vault = await resolveVault(req).catch(() => null);
  if (!vault) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { label, address } = await req.json();
  try {
    const contact = await addContact(vault.identityKey, label, address);
    return NextResponse.json(contact, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const vault = await resolveVault(req).catch(() => null);
  if (!vault) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { oldLabel, label, address } = await req.json();
  try {
    await patchContact(vault.identityKey, oldLabel, label, address);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const vault = await resolveVault(req).catch(() => null);
  if (!vault) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { label } = await req.json();
  await removeContact(vault.identityKey, label);
  return new NextResponse(null, { status: 204 });
}
