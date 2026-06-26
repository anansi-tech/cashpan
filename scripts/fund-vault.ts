/**
 * scripts/fund-vault.ts — mint test USD and deposit into ANY vault by id.
 *   tsx scripts/fund-vault.ts --vault 0xVAULT --amount 100
 * Needs TREASURY_CAP_ID in .env (printed by `npm run setup`).
 */
import "dotenv/config";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { ownerKeypair, required, toBase } from "./script-helpers";

async function main() {
  const args = process.argv.slice(2);
  const vault = args[args.indexOf("--vault") + 1];
  const human = args[args.indexOf("--amount") + 1];
  if (!vault || !human) throw new Error("Usage: --vault 0x.. --amount 100");

  const client = new SuiJsonRpcClient({ url: process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443" });
  const kp = ownerKeypair();
  const pkg = required("PACKAGE_ID");
  const coinType = required("COIN_TYPE");
  const cap = required("TREASURY_CAP_ID");
  const amount = toBase(human); // uses COIN_DECIMALS

  const tx = new Transaction();
  const [minted] = tx.moveCall({
    target: `${pkg}::test_usd::mint_coin`,        // see note below
    arguments: [tx.object(cap), tx.pure.u64(amount)],
  });
  tx.moveCall({ target: `${pkg}::vault::deposit`, typeArguments: [coinType], arguments: [tx.object(vault), minted] });

  const r = await client.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showEffects: true } });
  if (r.effects?.status.status !== "success") throw new Error(r.effects?.status.error);
  console.log(`Funded ${vault} with ${human} ${process.env.COIN_SYMBOL}. Digest: ${r.digest}`);
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });