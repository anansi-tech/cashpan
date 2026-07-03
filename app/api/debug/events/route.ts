import { NextResponse } from 'next/server';
import { resolveVault } from '@/lib/resolve-vault';

const GRAPHQL_URL  = process.env.SUI_GRAPHQL_URL ?? '';
const GRPC_TOKEN   = process.env.SUI_GRPC_TOKEN ?? '';
const AUTH_HEADER  = process.env.SUI_GRPC_AUTH_HEADER ?? '';
const PACKAGE_ID   = process.env.PACKAGE_ID ?? '';

export const dynamic = 'force-dynamic';

async function gql(query: string) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: GRPC_TOKEN },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

export async function GET(request: Request) {
  const vault = await resolveVault(request);

  const depositType = `${PACKAGE_ID}::vault::DepositEvent`;
  const [moveValueFields, sampleEvents] = await Promise.all([
    gql('{ __type(name: "MoveValue") { fields { name type { name kind } } } }'),
    gql(`{
      events(filter: { type: "${depositType}" }, last: 3) {
        nodes {
          contents
          timestamp
          transaction { digest }
        }
      }
    }`),
  ]);

  return NextResponse.json({
    packageId: PACKAGE_ID,
    vaultId: vault.vaultId,
    MoveValue_fields: (moveValueFields as { data?: { __type?: { fields?: unknown[] } } }).data?.__type?.fields,
    sampleEvents,
  });
}
