/**
 * Proactive brain watcher — Layer 2 of Block 3.
 *
 * Iterates all registered vaults, queries DepositEvents since a durable
 * per-vault Mongo cursor, advances the cursor. Read-only: no keys, no signing.
 *
 * Layer 1 (computeReadTimeProposals) is the correctness backstop — a stopped
 * watcher degrades to "proposal shown on next app open," never "event ignored."
 *
 * Called by /api/cron/watcher (Vercel Cron or any scheduler).
 */

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { listVaults, updateCursor } from './db/vault-registry';

const RPC_URL = process.env.SUI_RPC_URL ?? 'https://fullnode.mainnet.sui.io:443';
const PACKAGE_ID = process.env.PACKAGE_ID ?? '';

function makeClient(): SuiJsonRpcClient {
  return new SuiJsonRpcClient({ url: RPC_URL, network: 'mainnet' });
}

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

  const depositEventType = `${PACKAGE_ID}::vault::DepositEvent`;
  const client = makeClient();
  const vaults = await listVaults();

  let eventsFound = 0;
  let errors = 0;

  await Promise.allSettled(
    vaults.map(async (vault) => {
      try {
        // Parse durable cursor — null means start from the beginning
        const cursor: { txDigest: string; eventSeq: string } | null =
          vault.eventCursor ? (JSON.parse(vault.eventCursor) as { txDigest: string; eventSeq: string }) : null;

        const result = await client.queryEvents({
          query: { MoveEventType: depositEventType },
          cursor,
          limit: 50,
          order: 'ascending',
        });

        const vaultEvents = result.data.filter((ev) => {
          const json = ev.parsedJson as Record<string, unknown>;
          return String(json.vault_id ?? '') === vault.vaultId;
        });

        eventsFound += vaultEvents.length;

        // Advance cursor past all processed events
        if (result.nextCursor) {
          await updateCursor(vault.identityKey, JSON.stringify(result.nextCursor));
        }
      } catch (err) {
        errors++;
        console.error(`[watcher] vault ${vault.vaultId}:`, err instanceof Error ? err.message : err);
      }
    }),
  );

  return { vaultsProcessed: vaults.length, eventsFound, errors };
}
