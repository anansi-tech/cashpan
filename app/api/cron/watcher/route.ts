/**
 * Watcher cron endpoint — advances durable DepositEvent cursors for all vaults.
 *
 * Call this on a schedule (e.g. every 5 minutes via Vercel Cron or curl).
 * Protect with CRON_SECRET if exposed publicly:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Vercel Cron config (vercel.json):
 *   { "crons": [{ "path": "/api/cron/watcher", "schedule": "* /5 * * * *" }] }
 */

import { NextResponse } from 'next/server';
import { runWatcher } from '@/lib/watcher';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await runWatcher();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/cron/watcher]', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
