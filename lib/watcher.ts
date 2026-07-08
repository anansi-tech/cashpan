/**
 * Proactive brain watcher.
 *
 * ONE global cursor per event type (not per-vault). Pages forward through all
 * package events, dispatches to vaults via O(1) Map lookup, and persists the
 * cursor after each page so a crash only replays the current page.
 *
 * Called by /api/cron/watcher (Vercel Cron or any scheduler).
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

const PACKAGE_ID = process.env.PACKAGE_ID ?? '';
const SWEEP = 0;
const TOPUP = 1;

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

  const [vaults, depositCursor, rebalanceCursor] = await Promise.all([
    listVaults(network),
    getWatcherCursor(depositEventType),
    getWatcherCursor(rebalanceEventType),
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

  // ── Deposit events ───────────────────────────────────────────────────────────
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

  // ── Rebalance events (principal tracking) ────────────────────────────────────
  try {
    let cursor = rebalanceCursor;
    let hasMore = true;
    // Accumulate per-vault principal deltas across all pages before flushing.
    const principalMap = new Map<string, bigint>();

    while (hasMore) {
      const { events, nextCursor } = await queryPackageEvents(rebalanceEventType, cursor);

      for (const ev of events) {
        const json = ev.contents?.json;
        if (!json) continue;
        const vaultId = String(json.vault_id ?? '');
        const vault = vaultMap.get(vaultId);
        if (!vault) continue;

        const direction = Number(json.direction ?? -1);
        const amount = BigInt(String(json.amount ?? '0'));
        let principal = principalMap.get(vaultId) ?? BigInt(vault.savingsPrincipal ?? '0');

        if (direction === SWEEP) {
          principal += amount;
        } else if (direction === TOPUP) {
          try {
            const balances = await getBalances(vaultId);
            const savingsAfter = BigInt(balances.savingsValue);
            const valueBeforeWithdraw = savingsAfter + amount;
            if (valueBeforeWithdraw > 0n) {
              const reduction = (principal * amount) / valueBeforeWithdraw;
              principal = principal > reduction ? principal - reduction : 0n;
            }
          } catch {
            principal = principal > amount ? principal - amount : 0n;
          }
        }

        principalMap.set(vaultId, principal);
        eventsFound++;
      }

      if (nextCursor) await setWatcherCursor(rebalanceEventType, nextCursor);
      cursor = nextCursor;
      hasMore = nextCursor !== null;
    }

    // Flush principal updates after all pages are consumed.
    await Promise.allSettled(
      Array.from(principalMap.entries()).map(([vaultId, principal]) => {
        const vault = vaultMap.get(vaultId)!;
        return updateSavingsPrincipal(vault.identityKey, principal);
      }),
    );
  } catch (err) {
    errors++;
    console.error('[watcher] rebalance events:', err instanceof Error ? err.message : err);
  }

  // ── Reconcile: replay from genesis, self-heal if drift > 100 base units ──────
  // Uses simplified TOPUP subtraction (same as reconcile-principal.mjs) because
  // historical savings values are unavailable. Catches events that predated the
  // watcher cursor (pre-migration vaults) and corrects accumulated rounding drift.
  try {
    const reconMap = new Map<string, bigint>();
    let reconCursor: string | null = null;
    let reconMore = true;
    while (reconMore) {
      const { events: reconEvents, nextCursor } = await queryPackageEvents(rebalanceEventType, reconCursor);
      for (const ev of reconEvents) {
        const json = ev.contents?.json;
        if (!json) continue;
        const vaultId = String(json.vault_id ?? '');
        if (!vaultMap.has(vaultId)) continue;
        const direction = Number(json.direction ?? -1);
        const amount = BigInt(String(json.amount ?? '0'));
        let p = reconMap.get(vaultId) ?? 0n;
        if (direction === SWEEP) p += amount;
        else if (direction === TOPUP) p = p > amount ? p - amount : 0n;
        reconMap.set(vaultId, p);
      }
      reconCursor = nextCursor;
      reconMore = nextCursor !== null;
    }

    await Promise.allSettled(
      Array.from(reconMap.entries()).map(async ([vaultId, replayed]) => {
        const vault = vaultMap.get(vaultId)!;
        const stored = BigInt(vault.savingsPrincipal ?? '0');
        const diff = replayed > stored ? replayed - stored : stored - replayed;
        if (diff > 100n) {
          await updateSavingsPrincipal(vault.identityKey, replayed);
          console.log(`[watcher] reconcile ${vaultId.slice(0, 12)}… ${stored} → ${replayed} (diff ${diff})`);
        }
      }),
    );
  } catch (err) {
    errors++;
    console.error('[watcher] reconcile:', err instanceof Error ? err.message : err);
  }

  return { vaultsProcessed: vaults.length, eventsFound, errors };
}
