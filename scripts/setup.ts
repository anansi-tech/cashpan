/**
 * Cashpan setup script.
 *
 * Steps:
 *   1. Publish the Move package
 *   2. Call create_vault<SUI> → shares Vault, returns OwnerCap
 *   3. Call issue_agent_cap → returns AgentCap to a separate agent address
 *   4. Deposit an initial liquid balance
 *   5. Print all object IDs and write a ready .env
 *
 * Prerequisites:
 *   - `sui` CLI configured with the owner keypair as active address (testnet)
 *   - Run: tsx scripts/setup.ts
 *
 * The agent keypair is generated fresh and its private key is written to .env.
 * Store it securely — it can call rebalance() up to the configured caps.
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MOVE_DIR = join(ROOT, "move");

const RPC_URL = process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443";
const COIN_TYPE = "0x2::sui::SUI";

// Caps in MIST (1 SUI = 1_000_000_000 MIST)
const PER_TX_CAP = 500_000_000n;   // 0.5 SUI per tx
const DAILY_CAP = 2_000_000_000n;  // 2 SUI per day
const INITIAL_FUND = 500_000_000n; // 0.5 SUI to seed liquid balance

// Buffer rule (written to .env for agent to read)
const BUFFER = 1_000_000_000n;  // 1 SUI target liquid
const BAND = 100_000_000n;      // 0.1 SUI dead-band

async function main() {
  const client = new SuiJsonRpcClient({ url: RPC_URL });

  console.log("=== Cashpan Setup ===\n");

  // ---- 1. Publish the Move package ----
  console.log("1. Publishing Move package...");
  const publishOutput = execSync(
    `sui client publish --gas-budget 200000000 --json "${MOVE_DIR}"`,
    { encoding: "utf8" },
  );

  const publishResult = JSON.parse(publishOutput);
  if (publishResult.effects?.status?.status !== "success") {
    throw new Error(`Publish failed: ${JSON.stringify(publishResult.effects?.status)}`);
  }

  const packageId = publishResult.effects.created
    .find((obj: { owner: unknown }) => obj.owner === "Immutable")
    ?.reference?.objectId;

  if (!packageId) throw new Error("Could not find package ID in publish output");
  console.log(`   Package ID: ${packageId}`);

  // ---- 2. Create vault ----
  console.log("\n2. Creating vault...");
  const ownerAddress = execSync("sui client active-address", { encoding: "utf8" }).trim();

  const createTx = new Transaction();
  const ownerCapResult = createTx.moveCall({
    target: `${packageId}::vault::create_vault`,
    typeArguments: [COIN_TYPE],
    arguments: [
      createTx.pure.u64(PER_TX_CAP),
      createTx.pure.u64(DAILY_CAP),
    ],
  });
  createTx.transferObjects([ownerCapResult], ownerAddress);

  const createResult = await client.signAndExecuteTransaction({
    signer: ownerKeypair(),
    transaction: createTx,
    options: { showEffects: true, showObjectChanges: true },
  });

  if (createResult.effects?.status.status !== "success") {
    throw new Error(`create_vault failed: ${createResult.effects?.status.error}`);
  }

  const vaultId = createResult.objectChanges?.find(
    (c) => c.type === "created" && "objectType" in c && c.objectType.includes("::vault::Vault"),
  )?.["objectId"];
  const ownerCapId = createResult.objectChanges?.find(
    (c) => c.type === "created" && "objectType" in c && c.objectType.includes("OwnerCap"),
  )?.["objectId"];

  if (!vaultId || !ownerCapId) throw new Error("Could not find Vault or OwnerCap IDs");
  console.log(`   Vault ID:    ${vaultId}`);
  console.log(`   OwnerCap ID: ${ownerCapId}`);

  // ---- 3. Generate agent keypair + issue AgentCap ----
  console.log("\n3. Issuing AgentCap...");
  const agentKeypair = new Ed25519Keypair();
  const agentAddress = agentKeypair.getPublicKey().toSuiAddress();
  console.log(`   Agent address: ${agentAddress}`);

  const issueTx = new Transaction();
  const agentCapResult = issueTx.moveCall({
    target: `${packageId}::vault::issue_agent_cap`,
    typeArguments: [COIN_TYPE],
    arguments: [issueTx.object(ownerCapId), issueTx.object(vaultId)],
  });
  issueTx.transferObjects([agentCapResult], agentAddress);

  const issueResult = await client.signAndExecuteTransaction({
    signer: ownerKeypair(),
    transaction: issueTx,
    options: { showEffects: true, showObjectChanges: true },
  });

  if (issueResult.effects?.status.status !== "success") {
    throw new Error(`issue_agent_cap failed: ${issueResult.effects?.status.error}`);
  }

  const agentCapId = issueResult.objectChanges?.find(
    (c) => c.type === "created" && "objectType" in c && c.objectType.includes("AgentCap"),
  )?.["objectId"];
  if (!agentCapId) throw new Error("Could not find AgentCap ID");
  console.log(`   AgentCap ID: ${agentCapId}`);

  // ---- 4. Fund vault liquid balance ----
  console.log("\n4. Funding vault...");
  const fundTx = new Transaction();
  const [fundCoin] = fundTx.splitCoins(fundTx.gas, [INITIAL_FUND]);
  fundTx.moveCall({
    target: `${packageId}::vault::deposit`,
    typeArguments: [COIN_TYPE],
    arguments: [fundTx.object(ownerCapId), fundTx.object(vaultId), fundCoin],
  });

  const fundResult = await client.signAndExecuteTransaction({
    signer: ownerKeypair(),
    transaction: fundTx,
    options: { showEffects: true },
  });

  if (fundResult.effects?.status.status !== "success") {
    throw new Error(`deposit failed: ${fundResult.effects?.status.error}`);
  }
  console.log(`   Deposited ${INITIAL_FUND} MIST into liquid`);

  // ---- 5. Write .env ----
  console.log("\n5. Writing .env...");
  const env = `# Generated by setup.ts — do not commit
SUI_RPC_URL=${RPC_URL}
PACKAGE_ID=${packageId}
VAULT_ID=${vaultId}
OWNER_CAP_ID=${ownerCapId}
AGENT_CAP_ID=${agentCapId}
AGENT_PRIVATE_KEY=${agentKeypair.getSecretKey()}
COIN_TYPE=${COIN_TYPE}
BUFFER=${BUFFER}
BAND=${BAND}
INTERVAL_MS=300000
`;

  const envPath = join(ROOT, ".env");
  writeFileSync(envPath, env);
  console.log(`   Wrote ${envPath}`);

  console.log("\n=== Setup complete ===");
  console.log("\nRun the agent:");
  console.log("  npm run agent\n");
  console.log("Explorer links:");
  console.log(`  Package: https://suiexplorer.com/object/${packageId}?network=testnet`);
  console.log(`  Vault:   https://suiexplorer.com/object/${vaultId}?network=testnet`);
}

/** Load the keypair for the current `sui client active-address` from the keystore. */
function ownerKeypair(): Ed25519Keypair {
  const activeAddress = execSync("sui client active-address", { encoding: "utf8" }).trim();

  const homeDir = process.env.HOME ?? "/root";
  const keystorePath = join(homeDir, ".sui", "sui_config", "sui.keystore");

  if (!existsSync(keystorePath)) {
    throw new Error(`Keystore not found at ${keystorePath}. Run 'sui client' first.`);
  }

  const keystore: string[] = JSON.parse(readFileSync(keystorePath, "utf8"));

  for (const entry of keystore) {
    const raw = Buffer.from(entry, "base64");
    // Ed25519: scheme byte (0x00) + 32-byte private key seed
    if (raw[0] !== 0x00) continue; // skip non-Ed25519 keys
    const kp = Ed25519Keypair.fromSecretKey(raw.slice(1, 33));
    if (kp.getPublicKey().toSuiAddress() === activeAddress) return kp;
  }

  throw new Error(
    `No key in keystore matches active address ${activeAddress}. ` +
    `Run 'sui client switch --address <addr>' to select the right address.`,
  );
}

main().catch((e) => {
  console.error("Setup failed:", e);
  process.exit(1);
});
