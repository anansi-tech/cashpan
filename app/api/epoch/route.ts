import { NextResponse } from 'next/server';

const GRAPHQL_URL  = process.env.SUI_GRAPHQL_URL ?? '';
const GRPC_TOKEN   = process.env.SUI_GRPC_TOKEN ?? '';
const AUTH_HEADER  = process.env.SUI_GRPC_AUTH_HEADER ?? '';

export async function GET() {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: GRPC_TOKEN },
    body: JSON.stringify({ query: '{ epoch { epochId } }' }),
  });
  const data = await res.json() as { data?: { epoch?: { epochId?: string } } };
  const epochId = Number(data.data?.epoch?.epochId ?? 0);
  return NextResponse.json({ epochId });
}
