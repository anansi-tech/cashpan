/**
 * scripts/create-vault.ts — create a vault on-chain and register it in Mongo.
 *
 *   tsx scripts/create-vault.ts --identity alice --amount 100
 *   tsx scripts/create-vault.ts --identity bob   --amount 50
 *
 * What it does:
 *   1. Creates a Vault<T> on-chain bound to the shared YieldVenue
 *   2. Issues an AgentCap to the existing test agent address (same key signs all test vaults)
 *   3. Funds vault liquid with --amount (default $100, human decimal)
 *   4. Registers {identityKey, vaultId, ownerCapId, agentCapId, payoutAddress, coinType} in Mongo
 *
 * Prerequisites: PACKAGE_ID, VENUE_ID, COIN_TYPE, AGENT_PRIVATE_KEY, MONGODB_URI in .env
 */

import "dotenv/config";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { required, ownerKeypair, coinArg } from "./script-helpers.js";
import { humanToBase } from "../lib/coin-config.js";
import { registerVault } from "../lib/db/vault-registry.js";

// ── Per-vault caps (same as setup defaults; can parameterise later) ──────────
const PER_TX_CAP_HUMAN       = "50";
const DAILY_CAP_HUMAN        = "200";
const OUTFLOW_PER_TX_CAP_HUMAN = "20";
const OUTFLOW_DAILY_CAP_HUMAN  = "100";

async function waitForTx(client: SuiJsonRpcClient, digest: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      const tx = await client.getTransactionBlock({ digest, options: {} });
      if (tx?.digest) return;
    } catch { /* not finalized */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Transaction ${digest} not confirmed after 30s`);
}

async function main() {
  const args = process.argv.slice(2);
  const identityIdx = args.indexOf("--identity");
  if (identityIdx === -1 || !args[identityIdx + 1]) throw new Error("Pass --identity <key>");
  const identityKey = args[identityIdx + 1];

  const amountIdx = args.indexOf("--amount");
  const amountHuman = amountIdx !== -1 ? args[amountIdx + 1] : "100";

  const rpcUrl = process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443";
  const packageId = required("PACKAGE_ID");
  const venueId   = required("VENUE_ID");
  const coinType  = required("COIN_TYPE");

  const client  = new SuiJsonRpcClient({ url: rpcUrl });
  const keypair = ownerKeypair();
  const ownerAddress = keypair.getPublicKey().toSuiAddress();

  // The existing agent keypair — all test vaults share it so one key signs.
  const agentKey = required("AGENT_PRIVATE_KEY");
  const agentKeypair = Ed25519Keypair.fromSecretKey(agentKey);
  const agentAddress = agentKeypair.getPublicKey().toSuiAddress();

  console.log(`\n=== create-vault: identity="${identityKey}" ===`);
  console.log(`Owner:  ${ownerAddress}`);
  console.log(`Agent:  ${agentAddress}`);

  // ── 1. Create vault + issue caps ────────────────────────────────────────────
  console.log("\n1. Creating vault...");
  const createTx = new Transaction();
  const [ownerCap] = createTx.moveCall({
    target: `${packageId}::vault::create_vault`,
    typeArguments: [coinType],
    arguments: [
      createTx.object(venueId),
      createTx.pure.address(ownerAddress),  // payout_address
      createTx.pure.u64(humanToBase(PER_TX_CAP_HUMAN)),
      createTx.pure.u64(humanToBase(DAILY_CAP_HUMAN)),
      createTx.pure.u64(humanToBase(OUTFLOW_PER_TX_CAP_HUMAN)),
      createTx.pure.u64(humanToBase(OUTFLOW_DAILY_CAP_HUMAN)),
    ],
  });
  createTx.transferObjects([ownerCap], createTx.pure.address(ownerAddress));

  const createResult = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: createTx,
    options: { showEffects: true, showObjectChanges: true },
  });
  if (createResult.effects?.status.status !== "success") {
    throw new Error(`create_vault failed: ${createResult.effects?.status.error}`);
  }

  // Extract vault ID (shared object) and OwnerCap ID from objectChanges
  const created = createResult.objectChanges ?? [];
  const vaultObj = created.find(
    (c) => c.type === "created" && "objectType" in c && typeof c.objectType === "string" &&
      c.objectType.includes("::vault::Vault"),
  );
  const ownerCapObj = created.find(
    (c) => c.type === "created" && "objectType" in c && typeof c.objectType === "string" &&
      c.objectType.includes("::vault::OwnerCap"),
  );

  if (!vaultObj || !("objectId" in vaultObj)) throw new Error("Could not find Vault in objectChanges");
  if (!ownerCapObj || !("objectId" in ownerCapObj)) throw new Error("Could not find OwnerCap in objectChanges");

  const vaultId    = vaultObj.objectId as string;
  const ownerCapId = ownerCapObj.objectId as string;
  console.log(`   Vault:    ${vaultId}`);
  console.log(`   OwnerCap: ${ownerCapId}`);
  await waitForTx(client, createResult.digest);

  // ── 2. Issue AgentCap to test agent ─────────────────────────────────────────
  console.log("\n2. Issuing AgentCap to test agent...");
  const capTx = new Transaction();
  const [agentCap] = capTx.moveCall({
    target: `${packageId}::vault::issue_agent_cap`,
    typeArguments: [coinType],
    arguments: [capTx.object(ownerCapId), capTx.object(vaultId)],
  });
  capTx.transferObjects([agentCap], capTx.pure.address(agentAddress));

  const capResult = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: capTx,
    options: { showEffects: true, showObjectChanges: true },
  });
  if (capResult.effects?.status.status !== "success") {
    throw new Error(`issue_agent_cap failed: ${capResult.effects?.status.error}`);
  }

  const agentCapObj = (capResult.objectChanges ?? []).find(
    (c) => c.type === "created" && "objectType" in c && typeof c.objectType === "string" &&
      c.objectType.includes("::vault::AgentCap"),
  );
  if (!agentCapObj || !("objectId" in agentCapObj)) throw new Error("Could not find AgentCap");
  const agentCapId = agentCapObj.objectId as string;
  console.log(`   AgentCap: ${agentCapId}`);
  await waitForTx(client, capResult.digest);

  // ── 3. Fund vault liquid ─────────────────────────────────────────────────────
  console.log(`\n3. Funding vault with $${amountHuman}...`);
  const depositTx = new Transaction();
  const depositCoin = await coinArg(client, depositTx, ownerAddress, coinType, humanToBase(amountHuman));
  depositTx.moveCall({
    target: `${packageId}::vault::deposit`,
    typeArguments: [coinType],
    arguments: [depositTx.object(vaultId), depositCoin],
  });
  const depositResult = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: depositTx,
    options: { showEffects: true },
  });
  if (depositResult.effects?.status.status !== "success") {
    throw new Error(`deposit failed: ${depositResult.effects?.status.error}`);
  }
  console.log(`   Funded $${amountHuman}`);

  // ── 4. Register in Mongo ─────────────────────────────────────────────────────
  console.log("\n4. Registering in Mongo...");
  await registerVault({
    identityKey,
    vaultId,
    ownerCapId,
    agentCapId,
    payoutAddress: ownerAddress,
    coinType,
  });
  console.log(`   Registered identity="${identityKey}"`);

  console.log(`\n✓ Done. Add to dev selector: ?user=${identityKey}`);
}

main().catch((e) => {
  console.error("create-vault failed:", e.message ?? e);
  process.exit(1);
});
