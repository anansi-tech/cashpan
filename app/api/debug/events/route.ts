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

  const [eventType, eventFilter, sampleEvents] = await Promise.all([
    gql('{ __type(name: "Event") { fields { name type { name kind ofType { name } } } } }'),
    gql('{ __type(name: "EventFilter") { inputFields { name type { name kind ofType { name } } } } }'),
    gql(`{
      events(last: 3) {
        nodes {
          sendingModule { package { address } name }
          sender { address }
          timestamp
          bcs
          transaction { digest }
        }
      }
    }`),
  ]);

  return NextResponse.json({
    packageId: PACKAGE_ID,
    vaultId: vault.vaultId,
    EventType_fields: (eventType as { data?: { __type?: { fields?: unknown[] } } }).data?.__type?.fields,
    EventFilter_fields: (eventFilter as { data?: { __type?: { inputFields?: unknown[] } } }).data?.__type?.inputFields,
    sampleEvents,
  });
}
