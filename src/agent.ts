/**
 * Cashpan agent — sense → decide → act loop.
 *
 * No LLM on this path. Load .env, read vault state, compute rebalance decision,
 * submit a PTB if needed. Runs on a plain setInterval.
 *
 * Security boundary: the agent keypair can ONLY call rebalance(), capped per-tx
 * and daily by the on-chain Vault. Owner can revoke the AgentCap at any time.
 */

import "dotenv/config";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { readVaultState } from "./sense.js";
import { decide } from "./decide.js";
import { act } from "./act.js";
import type { AgentConfig } from "./types.js";
import { humanToBase } from "../lib/coin-config.js";

function loadConfig(): AgentConfig {
  const required = [
    "PACKAGE_ID",
    "VAULT_ID",
    "VENUE_ID",
    "AGENT_CAP_ID",
    "AGENT_PRIVATE_KEY",
    "COIN_TYPE",
    "BUFFER",
    "BAND",
  ] as const;

  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing env var: ${key}`);
  }

  return {
    rpcUrl: process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443",
    packageId: process.env.PACKAGE_ID!,
    vaultId: process.env.VAULT_ID!,
    venueId: process.env.VENUE_ID!,
    agentCapId: process.env.AGENT_CAP_ID!,
    agentPrivateKey: process.env.AGENT_PRIVATE_KEY!,
    coinType: process.env.COIN_TYPE!,
    // BUFFER and BAND are human decimals (e.g. "50" = $50); convert to base units
    buffer: humanToBase(process.env.BUFFER!),
    band: humanToBase(process.env.BAND!),
    intervalMs: parseInt(process.env.INTERVAL_MS ?? "300000", 10),
  };
}

async function tick(client: SuiJsonRpcClient, keypair: Ed25519Keypair, config: AgentConfig) {
  const state = await readVaultState(client, config.vaultId, config.venueId);

  const decision = decide(state, {
    buffer: config.buffer,
    band: config.band,
    perTxCap: state.perTxCap,
  });

  const tag = `[${new Date().toISOString()}]`;

  if (decision.action === "noop") {
    console.log(`${tag} noop — liquid=${state.liquid} savings=${state.savings}`);
    return;
  }

  console.log(
    `${tag} ${decision.action} ${decision.amount} — liquid=${state.liquid} savings=${state.savings}`,
  );

  const digest = await act(client, keypair, decision, config);
  console.log(`${tag} tx submitted: ${digest}`);
}

async function main() {
  const config = loadConfig();

  const client = new SuiJsonRpcClient({ url: config.rpcUrl });

  // Agent private key is stored as a Bech32 string (suiprivk...) written by setup.ts.
  const keypair = Ed25519Keypair.fromSecretKey(config.agentPrivateKey);

  console.log(`Cashpan agent started`);
  console.log(`  vault:    ${config.vaultId}`);
  console.log(`  buffer:   ${config.buffer}`);
  console.log(`  band:     ${config.band}`);
  console.log(`  interval: ${config.intervalMs}ms`);
  console.log(`  agent:    ${keypair.getPublicKey().toSuiAddress()}\n`);

  const run = () =>
    tick(client, keypair, config).catch((e) =>
      console.error(`[${new Date().toISOString()}] tick error:`, e.message ?? e),
    );

  // Run immediately, then on schedule.
  await run();
  setInterval(run, config.intervalMs);
}

main();
