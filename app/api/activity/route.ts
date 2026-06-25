import { NextResponse } from 'next/server';
import { getAgentActivity } from '@/lib/read-layer';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get('limit') ?? '20'), 100);
  const data = await getAgentActivity(limit);
  return NextResponse.json(data);
}
