/**
 * scripts/send.ts — exercise the two send paths on testnet.
 *
 * Owner send (any recipient, no allowlist, no cap):
 *   tsx scripts/send.ts --owner --to 0xADDR --amount 10
 *
 * Agent send (recipient must be on the vault's allowlist):
 *   tsx scripts/send.ts --agent --to 0xADDR --amount 10
 *
 * Add a payee to the allowlist first:
 *   tsx scripts/send.ts --add-payee --to 0xADDR
 *
 * Amounts are human decimals (e.g. 10 = $10.00 at 6 decimals).
 * Prerequisites: .env populated by npm run setup.
 */

import "dotenv/config";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { required, ownerKeypair } from "./script-helpers.js";
import { humanToBase } from "../lib/coin-config.js";

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
  const coinSymbol = process.env.COIN_SYMBOL ?? "coin";
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
  if (amountIdx === -1 || !args[amountIdx + 1]) throw new Error("Pass --amount <human>");
  const amountHuman = args[amountIdx + 1];
  const amount = humanToBase(amountHuman);

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
    console.log(`Owner send $${amountHuman} ${coinSymbol} to ${recipient}...`);
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
    console.log(`Agent send $${amountHuman} ${coinSymbol} to ${recipient}...`);
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
