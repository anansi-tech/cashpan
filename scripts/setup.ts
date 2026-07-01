/**
 * Cashpan setup script — publishes vault + yield_venue on mainnet, creates
 * the Suilend-backed YieldVenue, and writes IDs to .env.
 *
 * Vaults are created per-user at sign-in — do NOT create one here.
 *
 * Prerequisites:
 *   - `sui` CLI with the owner keypair active on mainnet
 *   - Native USDC in the owner wallet (for gas; no USDC needed for setup itself)
 *   - Run: npm run setup
 */

import "dotenv/config";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { ownerKeypair } from "./script-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MOVE_DIR = join(ROOT, "move");

const RPC_URL = process.env.SUI_RPC_URL ?? "https://fullnode.mainnet.sui.io:443";

// Suilend mainnet main-pool constants (from @suilend/sdk / on-chain registry).
// LENDING_MARKET_ID and P_TYPE are stable published addresses.
// reserve_array_index is resolved dynamically at deploy time by coinType match.
const SUILEND_LENDING_MARKET_ID = "0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1";
const SUILEND_P_TYPE = "0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::suilend::MAIN_POOL";

// Native USDC on Sui mainnet (NOT bridged wUSDC).
const NATIVE_USDC_TYPE = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const COIN_DECIMALS = 6;
const COIN_SYMBOL = "USD";

const BUFFER_HUMAN = "50";
const BAND_HUMAN   = "5";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Merge updates into an existing .env file without touching other keys.
 *
 * `always` keys: overwrite existing value, or append if missing.
 * `defaults` keys: only append if missing — never overwrite.
 */
function patchEnv(
  rootDir: string,
  always: Record<string, string>,
  defaults: Record<string, string> = {},
): void {
  const envPath = join(rootDir, ".env");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const lines = existing.split("\n");
  const seen = new Set<string>();

  const updated = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)/);
    if (!m) return line;
    const key = m[1];
    seen.add(key);
    return key in always ? `${key}=${always[key]}` : line;
  });

  const missingAlways = Object.entries(always).filter(([k]) => !seen.has(k));
  if (missingAlways.length > 0) {
    updated.push("", "# Added by setup");
    for (const [k, v] of missingAlways) updated.push(`${k}=${v}`);
  }

  for (const [k, v] of Object.entries(defaults)) {
    if (!seen.has(k)) updated.push(`${k}=${v}`);
  }

  writeFileSync(envPath, updated.join("\n").trimEnd() + "\n");
}

/**
 * Clean Move artifacts that block a fresh publish.
 */
function resetMovePackage(moveDir: string): void {
  const lockPath = join(moveDir, "Move.lock");
  if (existsSync(lockPath)) {
    unlinkSync(lockPath);
    console.log("   Deleted Move.lock");
  }

  const pubPath = join(moveDir, "Published.toml");
  writeFileSync(pubPath, "# Managed by setup.ts — regenerated on each npm run setup\n");
  console.log("   Reset Published.toml");

  const tomlPath = join(moveDir, "Move.toml");
  const toml = readFileSync(tomlPath, "utf8");
  const cleaned = toml
    .split("\n")
    .filter((line) => !/^published-at\s*=/.test(line.trim()))
    .join("\n");
  if (cleaned !== toml) {
    writeFileSync(tomlPath, cleaned);
    console.log("   Removed published-at from Move.toml");
  }
}

async function waitForTx(client: SuiJsonRpcClient, digest: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      const tx = await client.getTransactionBlock({ digest, options: {} });
      if (tx?.digest) return;
    } catch { /* not finalized yet */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Transaction ${digest} not confirmed after 30s`);
}

// reserve_array_index is resolved live by scripts/resolve-suilend.mjs

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = new SuiJsonRpcClient({ url: RPC_URL, network: "mainnet" });
  const keypair = ownerKeypair();
  const ownerAddress = keypair.getPublicKey().toSuiAddress();

  console.log("=== Cashpan Setup (mainnet / Suilend) ===\n");
  console.log(`Owner:          ${ownerAddress}`);
  console.log(`LendingMarket:  ${SUILEND_LENDING_MARKET_ID}`);
  console.log(`P_TYPE:         ${SUILEND_P_TYPE}`);
  console.log(`COIN_TYPE:      ${NATIVE_USDC_TYPE}\n`);

  // ── 1. Resolve native-USDC reserve index (live — never read from stale env) ─
  console.log("1. Resolving native-USDC reserve_array_index from Suilend main pool...");
  const { resolveReserveIndex } = await import("./resolve-suilend.mjs") as {
    resolveReserveIndex: (rpcUrl: string) => Promise<{ arrayIndex: number; mintDecimals: number }>;
  };
  const { arrayIndex: reserveArrayIndex } = await resolveReserveIndex(RPC_URL);
  console.log(`   reserve_array_index = ${reserveArrayIndex}`);

  // ── 2. Publish Move package ─────────────────────────────────────────────────
  console.log("\n2. Publishing Move package (vault + yield_venue)...");
  resetMovePackage(MOVE_DIR);
  const publishOutput = execSync(
    `sui client publish --gas-budget 200000000 --json "${MOVE_DIR}"`,
    { encoding: "utf8" },
  );
  const publishResult = JSON.parse(publishOutput);
  if (publishResult.effects?.status?.status !== "success") {
    throw new Error(`Publish failed: ${JSON.stringify(publishResult.effects?.status)}`);
  }

  const published = publishResult.objectChanges?.find(
    (c: { type: string }) => c.type === "published",
  );
  if (!published) throw new Error("Could not find published package in objectChanges");
  const packageId = (published as { packageId: string }).packageId;
  console.log(`   Package ID: ${packageId}`);

  const publishDigest = publishResult.digest ?? publishResult.effects?.transactionDigest;
  if (publishDigest) await waitForTx(client, publishDigest);

  // ── 3. Create YieldVenue ────────────────────────────────────────────────────
  console.log("\n3. Creating YieldVenue<MAIN_POOL, USDC>...");
  const venueTx = new Transaction();
  venueTx.moveCall({
    target: `${packageId}::yield_venue::create_venue`,
    typeArguments: [SUILEND_P_TYPE, NATIVE_USDC_TYPE],
    arguments: [venueTx.pure.u64(reserveArrayIndex)],
  });
  const venueResult = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: venueTx,
    options: { showEffects: true, showObjectChanges: true },
  });
  if (venueResult.effects?.status.status !== "success") {
    throw new Error(`create_venue failed: ${venueResult.effects?.status.error}`);
  }
  const venueId = venueResult.objectChanges?.find(
    (c: Record<string, unknown>) =>
      c["type"] === "created" &&
      typeof c["objectType"] === "string" &&
      c["objectType"].includes("YieldVenue"),
  )?.["objectId"] as string;
  if (!venueId) throw new Error("Could not find YieldVenue ID");
  console.log(`   YieldVenue: ${venueId}`);
  await waitForTx(client, venueResult.digest);

  // ── 4. Patch .env ──────────────────────────────────────────────────────────
  const ctokenType = `${SUILEND_P_TYPE.replace(/::suilend::MAIN_POOL$/, "")}::reserve::CToken<${SUILEND_P_TYPE},${NATIVE_USDC_TYPE}>`;

  console.log("\n4. Patching .env...");
  patchEnv(
    ROOT,
    // always overwrite — generated fresh every publish
    {
      PACKAGE_ID: packageId,
      VENUE_ID: venueId,
      COIN_TYPE: NATIVE_USDC_TYPE,
      COIN_DECIMALS: String(COIN_DECIMALS),
      COIN_SYMBOL: COIN_SYMBOL,
      LENDING_MARKET_ID: SUILEND_LENDING_MARKET_ID,
      P_TYPE: SUILEND_P_TYPE,
      CTOKEN_TYPE: ctokenType,
      RESERVE_INDEX: String(reserveArrayIndex),
      SUI_RPC_URL: RPC_URL,
      NEXT_PUBLIC_SUI_NETWORK: "mainnet",
    },
    // defaults — set only if not already present
    {
      BUFFER: BUFFER_HUMAN,
      BAND: BAND_HUMAN,
    },
  );
  console.log("   Patched .env (auth/service keys preserved)");

  console.log("\n=== Setup complete ===");
  console.log(`\nCOIN_TYPE:     ${NATIVE_USDC_TYPE}`);
  console.log(`VENUE_ID:      ${venueId}`);
  console.log(`RESERVE_INDEX: ${reserveArrayIndex}`);
  console.log("\nStart the app:");
  console.log("  npm run dev\n");
  console.log("Explorer links:");
  console.log(`  Package: https://suiexplorer.com/object/${packageId}?network=mainnet`);
  console.log(`  Venue:   https://suiexplorer.com/object/${venueId}?network=mainnet`);
}

main().catch((e) => {
  console.error("Setup failed:", e);
  process.exit(1);
});
