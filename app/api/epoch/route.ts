import { NextResponse } from 'next/server';

const GRAPHQL_URL  = process.env.SUI_GRAPHQL_URL ?? '';
const GRPC_TOKEN   = process.env.SUI_GRPC_TOKEN ?? '';
const AUTH_HEADER  = process.env.SUI_GRPC_AUTH_HEADER ?? '';

// Without this, a GET route using no dynamic API gets frozen into the build
// by Next's Full Route Cache and serves a stale epoch in production.
export const dynamic = 'force-dynamic';

export async function GET() {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: GRPC_TOKEN },
    body: JSON.stringify({ query: '{ epoch { epochId } }' }),
  });
  const data = await res.json() as { data?: { epoch?: { epochId?: string } } };
  const epochId = Number(data.data?.epoch?.epochId ?? 0);
  return NextResponse.json({ epochId });
}
