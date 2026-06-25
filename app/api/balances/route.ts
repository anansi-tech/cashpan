import { NextResponse } from 'next/server';
import { getBalances } from '@/lib/read-layer';

export async function GET() {
  const data = await getBalances();
  return NextResponse.json(data);
}
