import { NextResponse } from 'next/server';
import { resolveVault } from '@/lib/resolve-vault';

const GRAPHQL_URL  = process.env.SUI_GRAPHQL_URL ?? '';
const GRPC_TOKEN   = process.env.SUI_GRPC_TOKEN ?? '';
const AUTH_HEADER  = process.env.SUI_GRPC_AUTH_HEADER ?? '';
const PACKAGE_ID   = process.env.PACKAGE_ID ?? '';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const vault = await resolveVault(request);
  const vaultId = vault.vaultId;

  const eventTypes = [
    `${PACKAGE_ID}::vault::RebalanceEvent`,
    `${PACKAGE_ID}::vault::DepositEvent`,
    `${PACKAGE_ID}::vault::WithdrawEvent`,
    `${PACKAGE_ID}::vault::SendEvent`,
  ];

  const results: Record<string, unknown> = {
    packageId: PACKAGE_ID,
    vaultId,
    graphqlUrl: GRAPHQL_URL ? GRAPHQL_URL.replace(/\/\/[^/]+/, '//***') : '(empty)',
    authHeaderSet: !!GRPC_TOKEN,
  };

  for (const eventType of eventTypes) {
    const shortName = eventType.split('::').pop()!;
    try {
      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: GRPC_TOKEN },
        body: JSON.stringify({
          query: `{
            events(filter: { eventType: "${eventType}" }, last: 5) {
              nodes { json type { repr } transactionBlock { digest } }
            }
          }`,
        }),
      });
      const data = await res.json() as {
        data?: { events?: { nodes?: unknown[] } };
        errors?: { message: string }[];
      };
      const nodes = data.data?.events?.nodes ?? [];
      results[shortName] = {
        count: nodes.length,
        errors: data.errors ?? null,
        matchingVault: nodes.filter((n) => {
          const node = n as { json?: Record<string, unknown> };
          return String(node.json?.vault_id ?? '') === vaultId;
        }).length,
        sample: nodes[0] ?? null,
      };
    } catch (err) {
      results[shortName] = { error: (err as Error).message };
    }
  }

  return NextResponse.json(results);
}
