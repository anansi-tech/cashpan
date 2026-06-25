import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/read-layer';

export async function GET() {
  const data = await getConfig();
  return NextResponse.json(data);
}
