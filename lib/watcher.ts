/**
 * Proactive brain watcher — Layer 2 of Block 3.
 *
 * Iterates all registered vaults, queries DepositEvents + RebalanceEvents
 * since durable per-vault cursors, advances cursors, and tracks
 * savingsPrincipal cost-basis for accrued-earnings display.
 *
 * Called by /api/cron/watcher (Vercel Cron or any scheduler).
 */

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { suiNetwork } from './sui';
import { listVaults, updateCursor, updateRebalanceCursor, updateSavingsPrincipal } from './db/vault-registry';
import { getBalances } from './read-layer';

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
  // TODO (pre-merge): migrate queryEvents → gRPC streaming worker before July 31.
  const rpcUrl = process.env.SUI_RPC_URL ?? 'https://fullnode.mainnet.sui.io:443';
  const client = new SuiJsonRpcClient({ url: rpcUrl, network: suiNetwork() });
  const vaults = await listVaults(network);

  let eventsFound = 0;
  let errors = 0;

  await Promise.allSettled(
    vaults.map(async (vault) => {
      try {
        // ── Backfill: seed savingsPrincipal for vaults that were registered before
        //    cost-basis tracking was added. Run once (when principal is '0') then
        //    never again — the execute path keeps it current going forward.
        if (!vault.savingsPrincipal || vault.savingsPrincipal === '0') {
          try {
            const balances = await getBalances(vault.vaultId);
            const savingsValue = BigInt(balances.savingsValue);
            if (savingsValue > 0n) {
              await updateSavingsPrincipal(vault.identityKey, savingsValue);
              vault.savingsPrincipal = savingsValue.toString();
            }
          } catch {
            // Non-fatal: watcher will retry on next tick
          }
        }

        // ── Deposit events (existing) ─────────────────────────────────────────
        const depositCursor: { txDigest: string; eventSeq: string } | null =
          vault.eventCursor ? JSON.parse(vault.eventCursor) as { txDigest: string; eventSeq: string } : null;

        const depositResult = await client.queryEvents({
          query: { MoveEventType: depositEventType },
          cursor: depositCursor,
          limit: 50,
          order: 'ascending',
        });

        const depositEvents = depositResult.data.filter((ev) => {
          const json = ev.parsedJson as Record<string, unknown>;
          return String(json.vault_id ?? '') === vault.vaultId;
        });
        eventsFound += depositEvents.length;

        if (depositResult.nextCursor) {
          await updateCursor(vault.identityKey, JSON.stringify(depositResult.nextCursor));
        }

        // ── Rebalance events (principal tracking) ─────────────────────────────
        const rebalanceCursor: { txDigest: string; eventSeq: string } | null =
          vault.rebalanceCursor ? JSON.parse(vault.rebalanceCursor) as { txDigest: string; eventSeq: string } : null;

        const rebalanceResult = await client.queryEvents({
          query: { MoveEventType: rebalanceEventType },
          cursor: rebalanceCursor,
          limit: 50,
          order: 'ascending',
        });

        const rebalanceEvents = rebalanceResult.data.filter((ev) => {
          const json = ev.parsedJson as Record<string, unknown>;
          return String(json.vault_id ?? '') === vault.vaultId;
        });

        if (rebalanceEvents.length > 0) {
          let principal = BigInt(vault.savingsPrincipal ?? '0');

          for (const ev of rebalanceEvents) {
            const json = ev.parsedJson as Record<string, unknown>;
            const direction = Number(json.direction ?? -1);
            const amount = BigInt(String(json.amount ?? '0'));

            if (direction === SWEEP) {
              principal += amount;
            } else if (direction === TOPUP) {
              // Proportional reduction: read savings value after withdrawal,
              // then reconstruct pre-withdrawal value as (current + amount).
              try {
                const balances = await getBalances(vault.vaultId);
                const savingsAfter = BigInt(balances.savingsValue);
                const valueBeforeWithdraw = savingsAfter + amount;
                if (valueBeforeWithdraw > 0n) {
                  const reduction = (principal * amount) / valueBeforeWithdraw;
                  principal = principal > reduction ? principal - reduction : 0n;
                }
              } catch {
                // Can't read current savings — subtract amount directly as fallback
                principal = principal > amount ? principal - amount : 0n;
              }
            }
          }

          await updateSavingsPrincipal(vault.identityKey, principal);
          eventsFound += rebalanceEvents.length;
        }

        if (rebalanceResult.nextCursor) {
          await updateRebalanceCursor(vault.identityKey, JSON.stringify(rebalanceResult.nextCursor));
        }
      } catch (err) {
        errors++;
        console.error(`[watcher] vault ${vault.vaultId}:`, err instanceof Error ? err.message : err);
      }
    }),
  );

  return { vaultsProcessed: vaults.length, eventsFound, errors };
}
