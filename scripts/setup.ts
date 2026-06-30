/**
 * Cashpan setup script — publishes vault + yield_venue + test_usd,
 * mints test USD, funds the venue reserve, and writes IDs to .env.
 *
 * Vaults are created per-user at sign-in — do NOT create one here.
 *
 * Prerequisites:
 *   - `sui` CLI with the owner keypair active on testnet
 *   - Run: npm run setup
 *
 * To switch stablecoins on mainnet: set COIN_TYPE / COIN_DECIMALS / COIN_SYMBOL
 * in .env and skip the test_usd mint step — no code change needed.
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

const RPC_URL = process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443";

// ─── Human-decimal amounts (coin-type-agnostic) ───────────────────────────────
// All values are COIN_SYMBOL units (e.g. "50" = $50.00 at 6 decimals).
// Converted to base units via humanToBase() after COIN_DECIMALS is known.

const COIN_DECIMALS_DEFAULT = 6; // test_usd is 6-decimal

const RATE_BPS = 1_000n;   // 10% / epoch
const PERIOD_EPOCHS = 1n;

const BUFFER_HUMAN           = "50";   // $50 target liquid
const BAND_HUMAN             = "5";    // $5 dead-band
const RESERVE_FUND_HUMAN     = "200";  // $200 venue reserve
const MINT_AMOUNT_HUMAN      = "2000"; // total minted (covers all needs)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function humanToBase(human: string, decimals: number): bigint {
  return BigInt(Math.round(parseFloat(human) * 10 ** decimals));
}

/**
 * Merge updates into an existing .env file without touching other keys.
 *
 * `always` keys: overwrite existing value, or append if missing.
 * `defaults` keys: only append if missing — never overwrite (user may have tuned them).
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
 * Clean Move artifacts that block a fresh publish:
 *   Move.lock    — regenerated each time; stale lock blocks republish
 *   Published.toml — records prior publication addresses; must be cleared for a new deploy
 *   published-at in Move.toml — written by `sui client publish`; must be absent for a new package
 */
function resetMovePackage(moveDir: string): void {
  const lockPath = join(moveDir, "Move.lock");
  if (existsSync(lockPath)) {
    unlinkSync(lockPath);
    console.log("   Deleted Move.lock");
  }

  // Reset Published.toml to an empty header (the CLI writes fresh entries after publish)
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = new SuiJsonRpcClient({ url: RPC_URL });
  const keypair = ownerKeypair();
  const ownerAddress = keypair.getPublicKey().toSuiAddress();

  console.log("=== Cashpan Setup ===\n");
  console.log(`Owner: ${ownerAddress}\n`);

  // ── 1. Publish ──────────────────────────────────────────────────────────────
  console.log("1. Publishing Move package (vault + yield_venue + test_usd)...");
  resetMovePackage(MOVE_DIR);
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

  const COIN_TYPE = `${packageId}::test_usd::TEST_USD`;
  const COIN_DECIMALS = COIN_DECIMALS_DEFAULT;
  const COIN_SYMBOL = "USD";
  const toBase = (human: string) => humanToBase(human, COIN_DECIMALS);

  // TreasuryCap<TEST_USD> is transferred to owner by the OTW init
  const treasuryCapId = publishResult.objectChanges?.find(
    (c: Record<string, unknown>) =>
      c["type"] === "created" &&
      typeof c["objectType"] === "string" &&
      c["objectType"].includes("TreasuryCap") &&
      c["objectType"].includes("TEST_USD"),
  )?.["objectId"];
  if (!treasuryCapId) throw new Error("Could not find TreasuryCap<TEST_USD> in publish output");
  console.log(`   TreasuryCap: ${treasuryCapId}`);

  const publishDigest = publishResult.digest ?? publishResult.effects?.transactionDigest;
  if (publishDigest) await waitForTx(client, publishDigest);

  // ── 2. Mint test USD to owner ───────────────────────────────────────────────
  console.log("\n2. Minting test USD...");
  const mintTx = new Transaction();
  mintTx.moveCall({
    target: `${packageId}::test_usd::mint`,
    arguments: [
      mintTx.object(treasuryCapId),
      mintTx.pure.u64(toBase(MINT_AMOUNT_HUMAN)),
      mintTx.pure.address(ownerAddress),
    ],
  });
  const mintResult = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: mintTx,
    options: { showEffects: true },
  });
  if (mintResult.effects?.status.status !== "success") {
    throw new Error(`mint failed: ${mintResult.effects?.status.error}`);
  }
  console.log(`   Minted $${MINT_AMOUNT_HUMAN} ${COIN_SYMBOL} to owner`);
  await waitForTx(client, mintResult.digest);

  // ── 3. Create YieldVenue ────────────────────────────────────────────────────
  console.log("\n3. Creating YieldVenue...");
  const venueTx = new Transaction();
  venueTx.moveCall({
    target: `${packageId}::yield_venue::create_venue`,
    typeArguments: [COIN_TYPE],
    arguments: [venueTx.pure.u64(RATE_BPS), venueTx.pure.u64(PERIOD_EPOCHS)],
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
      c["type"] === "created" && typeof c["objectType"] === "string" && c["objectType"].includes("YieldVenue"),
  )?.["objectId"] as string;
  if (!venueId) throw new Error("Could not find YieldVenue ID");
  console.log(`   YieldVenue: ${venueId}`);
  await waitForTx(client, venueResult.digest);

  // ── 4. Fund venue reserve ───────────────────────────────────────────────────
  console.log("\n4. Funding venue reserve...");
  const reserveTx = new Transaction();
  const reserveCoin = await coinArg(client, reserveTx, ownerAddress, COIN_TYPE, toBase(RESERVE_FUND_HUMAN));
  reserveTx.moveCall({
    target: `${packageId}::yield_venue::fund_reserve`,
    typeArguments: [COIN_TYPE],
    arguments: [reserveTx.object(venueId), reserveCoin],
  });
  const reserveResult = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: reserveTx,
    options: { showEffects: true },
  });
  if (reserveResult.effects?.status.status !== "success") {
    throw new Error(`fund_reserve failed: ${reserveResult.effects?.status.error}`);
  }
  console.log(`   Reserve: $${RESERVE_FUND_HUMAN} ${COIN_SYMBOL}`);
  await waitForTx(client, reserveResult.digest);

  // ── 5. Patch .env (only update generated keys; preserve auth/service keys) ──
  console.log("\n5. Patching .env...");
  patchEnv(
    ROOT,
    // always overwrite — these are generated fresh every publish
    {
      PACKAGE_ID: packageId,
      VENUE_ID: venueId,
      TREASURY_CAP_ID: treasuryCapId,
      COIN_TYPE: COIN_TYPE,
      COIN_DECIMALS: String(COIN_DECIMALS),
      COIN_SYMBOL: COIN_SYMBOL,
      // NEXT_PUBLIC_COIN_* are derived from COIN_* in next.config.ts — no need to set here
    },
    // defaults — set only if not already present (user may have tuned these)
    {
      SUI_RPC_URL: RPC_URL,
      BUFFER: BUFFER_HUMAN,
      BAND: BAND_HUMAN,
      INTERVAL_MS: "300000",
    },
  );
  console.log("   Patched .env (auth/service keys preserved)");

  console.log("\n=== Setup complete ===");
  console.log(`\nCOIN_TYPE: ${COIN_TYPE}`);
  console.log("\nStart the app:");
  console.log("  npm run dev\n");
  console.log("Explorer links:");
  console.log(`  Package: https://suiexplorer.com/object/${packageId}?network=testnet`);
  console.log(`  Venue:   https://suiexplorer.com/object/${venueId}?network=testnet`);
}

main().catch((e) => {
  console.error("Setup failed:", e);
  process.exit(1);
});
