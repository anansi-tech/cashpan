/**
 * scripts/deposit.ts — add stablecoin to the vault's liquid pocket.
 *
 * deposit() is now permissionless — no OwnerCap required.
 *
 *   tsx scripts/deposit.ts --amount 50    # deposit $50 (human decimal)
 *
 * Prerequisites: .env populated by npm run setup.
 */

import "dotenv/config";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { required, ownerKeypair, coinArg } from "./script-helpers.js";
import { humanToBase } from "../lib/coin-config.js";

async function main() {
  const args = process.argv.slice(2);
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
  const keypair = ownerKeypair();
  const owner = keypair.getPublicKey().toSuiAddress();

  const tx = new Transaction();
  const coin = await coinArg(client, tx, owner, coinType, amount);
  tx.moveCall({
    target: `${packageId}::vault::deposit`,
    typeArguments: [coinType],
    arguments: [tx.object(vaultId), coin],
  });

  console.log(`Depositing $${amountHuman} ${coinSymbol} into liquid...`);
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
