/**
 * CashPan Autopilot worker — Phase A.
 *
 * A rules engine, not an agent brain: it reads on-chain state, runs the SAME
 * pure policy the app's brain uses (lib/brain computeProposals), and executes
 * the resulting rebalance with a scoped AgentCap. There is NO model anywhere
 * on this path — the LLM never signs and never triggers signing.
 *
 * Safety comes from the chain, not from this process:
 *   - AgentCap is rebalance-only; it cannot send to any address.
 *   - per_tx_cap / daily_cap are vault fields the Move layer enforces.
 *   - revoke() bumps agent_nonce and kills the cap instantly.
 * The worker adds a local soft daily cap (owner's chosen limit) and a cooldown,
 * purely to avoid burning gas on transactions the chain would abort anyway.
 *
 * Env (worker only — AGENT_SECRET_KEY must NEVER be in the Next.js/Vercel env):
 *   AGENT_SECRET_KEY, MONGODB_URI, SUI_RPC_URL, SUI_GRAPHQL_URL,
 *   SUI_GRPC_TOKEN, SUI_GRPC_AUTH_HEADER, PACKAGE_ID, PACKAGE_ID_LATEST,
 *   VENUE_ID, COIN_TYPE, COIN_DECIMALS, NEXT_PUBLIC_SUI_NETWORK
 */

import 'dotenv/config';
import { createServer } from 'http';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiJsonRpcClient, JsonRpcHTTPTransport } from '@mysten/sui/jsonRpc';

import { computeProposals } from '../lib/brain.js';
import { getBalances } from '../lib/read-layer.js';
import { LENDING_MARKET_ID, LENDING_MARKET_TYPE } from '../lib/graphql.js';
import { buildAgentRebalanceTx, type VaultTxContext } from '../lib/vault-tx.js';
import { humanToBase } from '../lib/coin-config.js';
import { listAutopilotVaults, suspendAutopilot, type VaultRecord } from '../lib/db/vault-registry.js';
import { suiNetwork } from '../lib/sui.js';

const LOOP_MS = 60_000;
const COOLDOWN_MS = 5 * 60_000;      // per vault, per direction
const LOW_GAS_MIST = 500_000_000n;   // 0.5 SUI
const ABORT_SUSPEND_THRESHOLD = 3;
const SWEEP = 0 as const;
const TOPUP = 1 as const;

const PACKAGE_ID_LATEST = process.env.PACKAGE_ID_LATEST ?? process.env.PACKAGE_ID ?? '';
const VENUE_ID = process.env.VENUE_ID ?? '';
const COIN_TYPE = process.env.COIN_TYPE ?? '';

// ── Agent identity ────────────────────────────────────────────────────────────

function agentKeypair(): Ed25519Keypair {
  const secret = process.env.AGENT_SECRET_KEY;
  if (!secret) throw new Error('AGENT_SECRET_KEY not set (worker env only — never in the app env)');
  // Bech32 `suiprivkey1...` is the canonical form; base64 32-byte also accepted.
  if (secret.startsWith('suiprivkey')) return Ed25519Keypair.fromSecretKey(secret);
  const raw = Buffer.from(secret, 'base64');
  return Ed25519Keypair.fromSecretKey(raw.length === 33 ? raw.subarray(1) : raw);
}

// ── In-memory guards (restart-safe enough: chain caps are the real bound) ─────

const lastActionAt = new Map<string, number>();   // `${vaultId}:${direction}` → ms
const abortCounts = new Map<string, number>();    // vaultId → consecutive aborts
const spentThisEpoch = new Map<string, { epoch: string; base: bigint }>(); // soft daily cap

function onCooldown(vaultId: string, direction: number): boolean {
  const at = lastActionAt.get(`${vaultId}:${direction}`);
  return at !== undefined && Date.now() - at < COOLDOWN_MS;
}

/** Owner's soft daily limit, tracked per epoch to mirror the chain's window. */
function softCapRemaining(vault: VaultRecord, epoch: string): bigint | null {
  const capStr = vault.autopilot?.dailyCapBase;
  if (!capStr) return null; // no soft cap set — chain cap is the only bound
  const cap = BigInt(capStr);
  const rec = spentThisEpoch.get(vault.vaultId);
  const spent = rec && rec.epoch === epoch ? rec.base : 0n;
  return cap > spent ? cap - spent : 0n;
}

function recordSpend(vaultId: string, epoch: string, amount: bigint): void {
  const rec = spentThisEpoch.get(vaultId);
  const spent = rec && rec.epoch === epoch ? rec.base : 0n;
  spentThisEpoch.set(vaultId, { epoch, base: spent + amount });
}

// ── One vault tick ────────────────────────────────────────────────────────────

async function processVault(client: SuiJsonRpcClient, keypair: Ed25519Keypair, vault: VaultRecord): Promise<void> {
  const balances = await getBalances(vault.vaultId);
  const settings = { buffer: vault.buffer ?? '50', band: vault.band ?? '5' };

  // SAME pure policy the app's brain uses. walletBalance '0' — the agent can
  // never move a user's wallet funds, so arrival proposals are irrelevant here.
  const proposals = computeProposals('0', balances, settings);
  const action = proposals.find((p) => p.type === 'sweep-to-save' || p.type === 'topup-from-save');
  if (!action) return;

  const direction = action.type === 'sweep-to-save' ? SWEEP : TOPUP;
  if (onCooldown(vault.vaultId, direction)) return;

  let amount = humanToBase(action.amountSui);

  // Local soft-cap check — skip rather than burn gas on a guaranteed abort.
  const epoch = balances.currentEpoch;
  const remaining = softCapRemaining(vault, epoch);
  if (remaining !== null) {
    if (remaining === 0n) {
      console.log(`[autopilot] ${vault.vaultId.slice(0, 10)}… daily limit reached; waiting for next epoch`);
      return;
    }
    if (amount > remaining) amount = remaining; // partial move up to the limit
  }
  if (amount <= 0n) return;

  const ctx: VaultTxContext = {
    packageId: PACKAGE_ID_LATEST,
    coinType: COIN_TYPE,
    pType: LENDING_MARKET_TYPE,
    vaultId: vault.vaultId,
    ownerCapId: vault.ownerCapId,     // unused by the agent path
    venueId: VENUE_ID,
    lendingMarketId: LENDING_MARKET_ID,
    userAddress: vault.payoutAddress, // unused by the agent path
  };

  const tx = buildAgentRebalanceTx(vault.autopilot!.agentCapId!, direction, amount, ctx);
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  });

  if (result.effects?.status.status !== 'success') {
    throw new Error(result.effects?.status.error ?? 'rebalance failed');
  }

  lastActionAt.set(`${vault.vaultId}:${direction}`, Date.now());
  recordSpend(vault.vaultId, epoch, amount);
  abortCounts.delete(vault.vaultId);
  console.log(`[autopilot] ${direction === SWEEP ? 'swept' : 'topped up'} ${action.amountSui} for ${vault.vaultId.slice(0, 10)}… digest=${result.digest}`);
}

// ── Loop ──────────────────────────────────────────────────────────────────────

async function tick(client: SuiJsonRpcClient, keypair: Ed25519Keypair): Promise<void> {
  const network = suiNetwork();
  let vaults: VaultRecord[];
  try {
    vaults = await listAutopilotVaults(network);
  } catch (err) {
    console.error('[autopilot] could not load vaults:', err instanceof Error ? err.message : err);
    return;
  }

  for (const vault of vaults) {
    if (!vault.autopilot?.agentCapId) {
      console.warn(`[autopilot] ${vault.vaultId.slice(0, 10)}… enabled but has no agentCapId — skipping`);
      continue;
    }
    // Per-vault isolation: one vault's abort never stalls the loop.
    try {
      await processVault(client, keypair, vault);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const n = (abortCounts.get(vault.vaultId) ?? 0) + 1;
      abortCounts.set(vault.vaultId, n);
      console.error(`[autopilot] vault ${vault.vaultId.slice(0, 10)}… abort ${n}/${ABORT_SUSPEND_THRESHOLD}: ${msg}`);
      if (n >= ABORT_SUSPEND_THRESHOLD) {
        // Never retry-loop into gas burn — park it and make the owner re-enable.
        await suspendAutopilot(vault.identityKey, msg.slice(0, 200)).catch(() => {});
        abortCounts.delete(vault.vaultId);
        console.error(`[autopilot] SUSPENDED ${vault.vaultId.slice(0, 10)}… after ${ABORT_SUSPEND_THRESHOLD} aborts`);
      }
    }
  }
}

async function checkGas(client: SuiJsonRpcClient, address: string): Promise<void> {
  try {
    const { totalBalance } = await client.getBalance({ owner: address, coinType: '0x2::sui::SUI' });
    if (BigInt(totalBalance) < LOW_GAS_MIST) {
      console.warn(`[autopilot] LOW GAS: agent has ${Number(totalBalance) / 1e9} SUI (< 0.5) — fund ${address}`);
    }
  } catch { /* non-fatal */ }
}

async function main(): Promise<void> {
  const keypair = agentKeypair();
  const address = keypair.getPublicKey().toSuiAddress();
  console.log(`[autopilot] agent address: ${address}`);
  console.log(`[autopilot] network: ${suiNetwork()} | package: ${PACKAGE_ID_LATEST.slice(0, 12)}…`);

  // Same QuickNode endpoint as the app: JSON-RPC lives at the GraphQL URL
  // minus the /graphql path (mirrors /api/sponsor's rpcClient).
  const graphqlUrl = process.env.SUI_GRAPHQL_URL ?? '';
  const rpcUrl = process.env.SUI_RPC_URL || graphqlUrl.replace(/\/graphql\/?$/, '');
  if (!rpcUrl) throw new Error('Set SUI_RPC_URL or SUI_GRAPHQL_URL');
  const authHeader = process.env.SUI_GRPC_AUTH_HEADER ?? 'x-token';
  const token = process.env.SUI_GRPC_TOKEN ?? '';
  const client = new SuiJsonRpcClient({
    network: suiNetwork() as 'mainnet' | 'testnet' | 'devnet' | 'localnet',
    transport: new JsonRpcHTTPTransport({
      url: rpcUrl,
      rpc: { url: rpcUrl, headers: { [authHeader]: token } },
    }),
  });

  await checkGas(client, address);

  // Health endpoint for the platform (Railway/Fly).
  const port = Number(process.env.PORT ?? 8080);
  createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, agent: address, network: suiNetwork() }));
      return;
    }
    res.writeHead(404);
    res.end();
  }).listen(port, () => console.log(`[autopilot] healthz on :${port}`));

  let gasCheckCounter = 0;
  for (;;) {
    await tick(client, keypair);
    if (++gasCheckCounter % 10 === 0) await checkGas(client, address); // ~every 10 min
    await new Promise((r) => setTimeout(r, LOOP_MS));
  }
}

main().catch((err) => {
  console.error('[autopilot] fatal:', err);
  process.exit(1);
});
