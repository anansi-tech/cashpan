/**
 * scripts/send.ts — exercise the two send paths on testnet.
 *
 * Owner send (any recipient, no allowlist, no cap):
 *   tsx scripts/send.ts --owner --to 0xADDR --amount 50000000
 *
 * Agent send (recipient must be on owner-managed allowlist):
 *   tsx scripts/send.ts --agent --to 0xADDR --amount 50000000
 *
 * To add a payee to the allowlist first:
 *   tsx scripts/send.ts --add-payee --to 0xADDR
 *
 * Prerequisites: .env populated by setup.ts (npm run setup).
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
  const useOwner = args.includes("--owner");
  const useAgent = args.includes("--agent");
  const addPayee = args.includes("--add-payee");

  const toIdx = args.indexOf("--to");
  if (toIdx === -1 || !args[toIdx + 1]) throw new Error("Pass --to <address>");
  const recipient = args[toIdx + 1];

  const rpcUrl = process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443";
  const packageId = required("PACKAGE_ID");
  const vaultId = required("VAULT_ID");
  const coinType = required("COIN_TYPE");
  const ownerCapId = required("OWNER_CAP_ID");

  const client = new SuiJsonRpcClient({ url: rpcUrl });

  if (addPayee) {
    const keypair = ownerKeypair();
    const tx = new Transaction();
    tx.moveCall({
      target: `${packageId}::vault::add_payee`,
      typeArguments: [coinType],
      arguments: [tx.object(ownerCapId), tx.object(vaultId), tx.pure.address(recipient)],
    });
    console.log(`Adding ${recipient} to allowlist...`);
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
    });
    if (result.effects?.status.status !== "success") {
      throw new Error(`Failed: ${result.effects?.status.error}`);
    }
    console.log(`Done. Digest: ${result.digest}`);
    return;
  }

  if (!useOwner && !useAgent) throw new Error("Pass --owner, --agent, or --add-payee");
  if (useOwner && useAgent) throw new Error("Pass only one of --owner or --agent");

  const amountIdx = args.indexOf("--amount");
  if (amountIdx === -1 || !args[amountIdx + 1]) throw new Error("Pass --amount <mist>");
  const amount = BigInt(args[amountIdx + 1]);

  if (useOwner) {
    const keypair = ownerKeypair();
    const tx = new Transaction();
    tx.moveCall({
      target: `${packageId}::vault::owner_send`,
      typeArguments: [coinType],
      arguments: [
        tx.object(ownerCapId),
        tx.object(vaultId),
        tx.pure.u64(amount),
        tx.pure.address(recipient),
      ],
    });
    console.log(`Owner send ${amount} MIST to ${recipient}...`);
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true },
    });
    if (result.effects?.status.status !== "success") {
      throw new Error(`Failed: ${result.effects?.status.error}`);
    }
    console.log(`Done. Digest: ${result.digest}`);
  } else {
    const agentCapId = required("AGENT_CAP_ID");
    const agentKey = required("AGENT_PRIVATE_KEY");
    const keypair = Ed25519Keypair.fromSecretKey(agentKey);

    const tx = new Transaction();
    tx.moveCall({
      target: `${packageId}::vault::agent_send`,
      typeArguments: [coinType],
      arguments: [
        tx.object(agentCapId),
        tx.object(vaultId),
        tx.pure.u64(amount),
        tx.pure.address(recipient),
      ],
    });
    console.log(`Agent send ${amount} MIST to ${recipient}...`);
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
}

main().catch((e) => {
  console.error("send failed:", e.message ?? e);
  process.exit(1);
});
