/**
 * Proactive brain watcher.
 *
 * ONE global cursor per event type (not per-vault). Pages forward through all
 * package events, dispatches to vaults via O(1) Map lookup, and persists the
 * cursor after each page so a crash only replays the current page.
 *
 * Called by /api/cron/watcher (Vercel Cron or any scheduler).
 *
 * Principal tracking is ABSOLUTE, not incremental:
 * - The reconcile phase replays from genesis (cursor=null) every run.
 * - Result always overwrites Mongo unconditionally — idempotent by design.
 * - Eager execute-path writes (in /api/principal-update) are provisional;
 *   the next reconcile corrects any error.
 * - No incremental cursor-based principal accumulation; that pattern caused
 *   double-application when Mongo already held eager updates.
 */

import { suiNetwork } from './sui';
import {
  listVaults,
  updateSavingsPrincipal,
  getWatcherCursor,
  setWatcherCursor,
} from './db/vault-registry';
import { getBalances } from './read-layer';
import { queryPackageEvents } from './graphql';
import { replayPrincipal } from './principal-replay';

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
  const depositEventType   = `${PACKAGE_ID}::vault::DepositEvent`;
  const rebalanceEventType = `${PACKAGE_ID}::vault::RebalanceEvent`;

  const [vaults, depositCursor] = await Promise.all([
    listVaults(network),
    getWatcherCursor(depositEventType),
  ]);

  // O(1) dispatch: vaultId → VaultRecord
  const vaultMap = new Map(vaults.map((v) => [v.vaultId, v]));
  let eventsFound = 0;
  let errors = 0;

  // ── Backfill: seed savingsPrincipal for vaults registered before cost-basis tracking ──
  await Promise.allSettled(
    vaults
      .filter((v) => !v.savingsPrincipal || v.savingsPrincipal === '0')
      .map(async (vault) => {
        try {
          const balances = await getBalances(vault.vaultId);
          const savingsValue = BigInt(balances.savingsValue);
          if (savingsValue > 0n) {
            await updateSavingsPrincipal(vault.identityKey, savingsValue);
            vault.savingsPrincipal = savingsValue.toString();
          }
        } catch { /* non-fatal */ }
      }),
  );

  // ── Deposit events (incremental, cursor-based, no principal tracking) ────────
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

  // ── Reconcile: absolute genesis replay, always overwrites ────────────────────
  // Fetches ALL RebalanceEvents from genesis (cursor=null), filters per-vault,
  // replays from zero using replayPrincipal(), and writes unconditionally.
  // Idempotency: running N times in a row produces the same Mongo value each time.
  try {
    type EventPage = Awaited<ReturnType<typeof queryPackageEvents>>['events'];
    const allEvents: EventPage = [];
    let reconCursor: string | null = null;
    let reconMore = true;
    while (reconMore) {
      const { events: page, nextCursor } = await queryPackageEvents(rebalanceEventType, reconCursor);
      allEvents.push(...page);
      reconCursor = nextCursor;
      reconMore = nextCursor !== null;
    }

    await Promise.allSettled(
      Array.from(vaultMap.entries()).map(async ([vaultId, vault]) => {
        const vaultEvents = allEvents.filter(
          (ev) => String(ev.contents?.json?.vault_id ?? '') === vaultId,
        );
        if (vaultEvents.length === 0) return;
        const { principal: replayed } = replayPrincipal(vaultEvents);
        const stored = vault.savingsPrincipal ?? '0';
        await updateSavingsPrincipal(vault.identityKey, replayed);
        if (replayed.toString() !== stored) {
          console.log(`[watcher] reconcile ${vaultId.slice(0, 12)}… ${stored} → ${replayed}`);
        }
      }),
    );
  } catch (err) {
    errors++;
    console.error('[watcher] reconcile:', err instanceof Error ? err.message : err);
  }

  return { vaultsProcessed: vaults.length, eventsFound, errors };
}
