/**
 * scripts/withdraw.ts — exercise the two withdraw paths on testnet.
 *
 * Owner withdraw (returns coin to owner):
 *   tsx scripts/withdraw.ts --owner --amount 10
 *
 * Agent withdraw to payout address:
 *   tsx scripts/withdraw.ts --agent --amount 10
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
  const useAgent = args.includes("--agent");
  const useOwner = args.includes("--owner");
  if (!useAgent && !useOwner) throw new Error("Pass --owner or --agent");
  if (useAgent && useOwner) throw new Error("Pass only one of --owner or --agent");

  const amountIdx = args.indexOf("--amount");
  if (amountIdx === -1 || !args[amountIdx + 1]) throw new Error("Pass --amount <human>");
  const amountHuman = args[amountIdx + 1];
  const amount = humanToBase(amountHuman);

  const rpcUrl = process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443";
  const packageId = required("PACKAGE_ID");
  const vaultId = required("VAULT_ID");
  const coinType = required("COIN_TYPE");
  const coinSymbol = process.env.COIN_SYMBOL ?? "coin";

  const client = new SuiJsonRpcClient({ url: rpcUrl });

  if (useOwner) {
    const ownerCapId = required("OWNER_CAP_ID");
    const keypair = ownerKeypair();
    const tx = new Transaction();
    const coin = tx.moveCall({
      target: `${packageId}::vault::withdraw`,
      typeArguments: [coinType],
      arguments: [tx.object(ownerCapId), tx.object(vaultId), tx.pure.u64(amount)],
    });
    tx.transferObjects([coin], keypair.getPublicKey().toSuiAddress());

    console.log(`Owner withdraw $${amountHuman} ${coinSymbol} from liquid...`);
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
      target: `${packageId}::vault::agent_withdraw_to_owner`,
      typeArguments: [coinType],
      arguments: [tx.object(agentCapId), tx.object(vaultId), tx.pure.u64(amount)],
    });

    console.log(`Agent withdraw_to_owner $${amountHuman} ${coinSymbol} from liquid...`);
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
  console.error("withdraw failed:", e.message ?? e);
  process.exit(1);
});
