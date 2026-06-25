/**
 * scripts/deposit.ts — add SUI to the vault's liquid pocket (owner only).
 * Pushing liquid above buffer+band triggers the agent's next sweep.
 *
 *   tsx scripts/deposit.ts --amount 300000000   # 0.3 SUI
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

async function main() {
  const args = process.argv.slice(2);
  const amountIdx = args.indexOf("--amount");
  if (amountIdx === -1 || !args[amountIdx + 1]) throw new Error("Pass --amount <mist>");
  const amount = BigInt(args[amountIdx + 1]);

  const rpcUrl = process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443";
  const packageId = required("PACKAGE_ID");
  const vaultId = required("VAULT_ID");
  const coinType = required("COIN_TYPE");
  const ownerCapId = required("OWNER_CAP_ID");

  const client = new SuiJsonRpcClient({ url: rpcUrl });
  const keypair = ownerKeypair();

  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [amount]);
  tx.moveCall({
    target: `${packageId}::vault::deposit`,
    typeArguments: [coinType],
    arguments: [tx.object(ownerCapId), tx.object(vaultId), coin],
  });

  console.log(`Depositing ${amount} MIST into liquid...`);
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  });
  if (result.effects?.status.status !== "success") {
    throw new Error(`Failed: ${result.effects?.status.error}`);
  }
  console.log(`Done. Digest: ${result.digest}`);
}

main().catch((e) => {
  console.error("deposit failed:", e.message ?? e);
  process.exit(1);
});