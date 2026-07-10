/**
 * Proactive brain watcher.
 *
 * ONE global cursor per event type (not per-vault). Pages forward through all
 * package events, dispatches to vaults via O(1) Map lookup, and persists the
 * cursor after each page so a crash only replays the current page.
 *
 * Called by /api/cron/watcher (Vercel Cron or any scheduler).
 *
 * Principal (cost basis) is NOT tracked here — it is derived on-read from the
 * RebalanceEvent stream in lib/principal-replay.ts. Nothing to reconcile.
 */

import { suiNetwork } from './sui';
import {
  listVaults,
  getWatcherCursor,
  setWatcherCursor,
} from './db/vault-registry';
import { queryPackageEvents } from './graphql';

const PACKAGE_ID = process.env.PACKAGE_ID ?? '';

export interface WatcherResult {
  vaultsProcessed: number;
  eventsFound: number;
  errors: number;
}

export async function runWatcher(): Promise<WatcherResult> {
  if (!PACKAGE_ID) {
    console.warn('[watcher] PACKAGE_ID not set — skipping');
    return { vaultsProcessed: 0, eventsFound: 0, errors: 0 };
  }

  const network = suiNetwork();
  const depositEventType = `${PACKAGE_ID}::vault::DepositEvent`;

  const [vaults, depositCursor] = await Promise.all([
    listVaults(network),
    getWatcherCursor(depositEventType),
  ]);

  // O(1) dispatch: vaultId → VaultRecord
  const vaultMap = new Map(vaults.map((v) => [v.vaultId, v]));
  let eventsFound = 0;
  let errors = 0;

  // ── Deposit events (incremental, cursor-based) ───────────────────────────────
  try {
    let cursor = depositCursor;
    let hasMore = true;
    while (hasMore) {
      const { events, nextCursor } = await queryPackageEvents(depositEventType, cursor);
      for (const ev of events) {
        const vaultId = String(ev.contents?.json?.vault_id ?? '');
        if (vaultMap.has(vaultId)) eventsFound++;
      }
      if (nextCursor) await setWatcherCursor(depositEventType, nextCursor);
      cursor = nextCursor;
      hasMore = nextCursor !== null;
    }
  } catch (err) {
    errors++;
    console.error('[watcher] deposit events:', err instanceof Error ? err.message : err);
  }

  return { vaultsProcessed: vaults.length, eventsFound, errors };
}
