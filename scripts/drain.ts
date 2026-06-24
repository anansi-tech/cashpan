/**
 * scripts/drain.ts — recover all SUI from the vault before a re-deploy.
 *
 * 1. Redeems savings position back to liquid (if one exists)
 * 2. Withdraws all liquid to the owner's wallet
 *
 * Run this BEFORE `npm run setup` to reclaim your testnet SUI.
 *
 *   tsx scripts/drain.ts
 */

import "dotenv/config";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function ownerKeypair(): Ed25519Keypair {
  const activeAddress = execSync("sui client active-address", { encoding: "utf8" }).trim();
  const keystorePath = join(process.env.HOME ?? "/root", ".sui", "sui_config", "sui.keystore");
  if (!existsSync(keystorePath)) throw new Error(`Keystore not found at ${keystorePath}`);
  const keystore: string[] = JSON.parse(readFileSync(keystorePath, "utf8"));
  for (const entry of keystore) {
    const raw = Buffer.from(entry, "base64");
    if (raw[0] !== 0x00) continue;
    const kp = Ed25519Keypair.fromSecretKey(raw.slice(1, 33));
    if (kp.getPublicKey().toSuiAddress() === activeAddress) return kp;
  }
  throw new Error(`No key matches active address ${activeAddress}`);
}

async function waitForTx(client: SuiJsonRpcClient, digest: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      const tx = await client.getTransactionBlock({ digest, options: {} });
      if (tx?.digest) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Transaction ${digest} not confirmed after 30s`);
}

async function main() {
  const rpcUrl = process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443";
  const packageId = required("PACKAGE_ID");
  const vaultId = required("VAULT_ID");
  const venueId = required("VENUE_ID");
  const ownerCapId = required("OWNER_CAP_ID");
  const coinType = required("COIN_TYPE");

  const client = new SuiJsonRpcClient({ url: rpcUrl });
  const keypair = ownerKeypair();
  const ownerAddress = keypair.getPublicKey().toSuiAddress();

  // Read current vault state.
  const vaultObj = await client.getObject({ id: vaultId, options: { showContent: true } });
  if (vaultObj.data?.content?.dataType !== "moveObject") throw new Error("Vault not found");
  const fields = vaultObj.data.content.fields as Record<string, unknown>;
  const liquid = BigInt((fields.liquid as Record<string, string>).value ?? (fields.liquid as string));
  const hasSavings = fields.savings_position !== null;

  console.log(`=== Vault drain ===`);
  console.log(`  liquid:   ${liquid} MIST (${Number(liquid) / 1e9} SUI)`);
  console.log(`  savings:  ${hasSavings ? "yes" : "none"}\n`);

  // Step 1: redeem savings position → liquid.
  if (hasSavings) {
    console.log("1. Redeeming savings position...");
    const redeemTx = new Transaction();
    redeemTx.moveCall({
      target: `${packageId}::vault::redeem_position`,
      typeArguments: [coinType],
      arguments: [redeemTx.object(ownerCapId), redeemTx.object(vaultId), redeemTx.object(venueId)],
    });
    const redeemResult = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: redeemTx,
      options: { showEffects: true },
    });
    if (redeemResult.effects?.status.status !== "success") {
      throw new Error(`redeem_position failed: ${redeemResult.effects?.status.error}`);
    }
    console.log(`   Done. Digest: ${redeemResult.digest}`);
    await waitForTx(client, redeemResult.digest);
  }

  // Step 2: read updated liquid balance after redeem.
  const vaultObj2 = await client.getObject({ id: vaultId, options: { showContent: true } });
  const fields2 = (vaultObj2.data!.content as { fields: Record<string, unknown> }).fields;
  const totalLiquid = BigInt((fields2.liquid as Record<string, string>).value ?? (fields2.liquid as string));

  if (totalLiquid === 0n) {
    console.log("\nNothing to withdraw — vault is empty.");
    return;
  }

  // Step 3: withdraw all liquid to owner.
  console.log(`\n2. Withdrawing ${totalLiquid} MIST to ${ownerAddress}...`);
  const withdrawTx = new Transaction();
  const coin = withdrawTx.moveCall({
    target: `${packageId}::vault::withdraw`,
    typeArguments: [coinType],
    arguments: [
      withdrawTx.object(ownerCapId),
      withdrawTx.object(vaultId),
      withdrawTx.pure.u64(totalLiquid),
    ],
  });
  withdrawTx.transferObjects([coin], ownerAddress);

  const withdrawResult = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: withdrawTx,
    options: { showEffects: true },
  });
  if (withdrawResult.effects?.status.status !== "success") {
    throw new Error(`withdraw failed: ${withdrawResult.effects?.status.error}`);
  }
  console.log(`   Done. Digest: ${withdrawResult.digest}`);
  console.log(`\n   Recovered ${Number(totalLiquid) / 1e9} SUI to your wallet.`);
  console.log(`   (Venue reserve is separate — use sui client gas to confirm your balance)`);
}

main().catch((e) => {
  console.error("drain failed:", e.message ?? e);
  process.exit(1);
});
