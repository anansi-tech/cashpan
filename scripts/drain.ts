/**
 * scripts/drain.ts — recover all stablecoin from the vault before a re-deploy.
 *
 * 1. Redeems savings position back to liquid (if one exists)
 * 2. Withdraws all liquid to the owner's wallet
 *
 * Run this BEFORE `npm run setup` to reclaim your testnet funds.
 *
 *   tsx scripts/drain.ts
 */

import "dotenv/config";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { required, ownerKeypair } from "./script-helpers.js";
import { baseToHuman } from "../lib/coin-config.js";

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

async function main() {
  const rpcUrl = process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443";
  const packageId = required("PACKAGE_ID");
  const vaultId = required("VAULT_ID");
  const venueId = required("VENUE_ID");
  const ownerCapId = required("OWNER_CAP_ID");
  const coinType = required("COIN_TYPE");
  const coinSymbol = process.env.COIN_SYMBOL ?? "coin";

  const client = new SuiJsonRpcClient({ url: rpcUrl });
  const keypair = ownerKeypair();
  const ownerAddress = keypair.getPublicKey().toSuiAddress();

  const vaultObj = await client.getObject({ id: vaultId, options: { showContent: true } });
  if (vaultObj.data?.content?.dataType !== "moveObject") throw new Error("Vault not found");
  const fields = vaultObj.data.content.fields as Record<string, unknown>;

  const liquidField = fields.liquid as Record<string, string> | string;
  const liquid = BigInt(typeof liquidField === "object" ? liquidField["value"] ?? "0" : liquidField);
  const hasSavings = fields.savings_position !== null;

  console.log(`=== Vault drain ===`);
  console.log(`  liquid:  $${baseToHuman(liquid)} ${coinSymbol}`);
  console.log(`  savings: ${hasSavings ? "yes" : "none"}\n`);

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

  const vaultObj2 = await client.getObject({ id: vaultId, options: { showContent: true } });
  const fields2 = (vaultObj2.data!.content as { fields: Record<string, unknown> }).fields;
  const liq2 = fields2.liquid as Record<string, string> | string;
  const totalLiquid = BigInt(typeof liq2 === "object" ? liq2["value"] ?? "0" : liq2);

  if (totalLiquid === 0n) {
    console.log("\nNothing to withdraw — vault is empty.");
    return;
  }

  console.log(`\n${hasSavings ? "2" : "1"}. Withdrawing $${baseToHuman(totalLiquid)} ${coinSymbol} to ${ownerAddress}...`);
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
  console.log(`\n   Recovered $${baseToHuman(totalLiquid)} ${coinSymbol} to your wallet.`);
  console.log(`   (Venue reserve is separate — check your stablecoin balance to confirm)`);
}

main().catch((e) => {
  console.error("drain failed:", e.message ?? e);
  process.exit(1);
});
