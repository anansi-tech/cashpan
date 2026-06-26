/**
 * scripts/fund-vault.ts — mint test USD and deposit into ANY vault by id.
 *   tsx scripts/fund-vault.ts --vault 0xVAULT --amount 100
 * Needs TREASURY_CAP_ID in .env (printed by `npm run setup`).
 *
 * Reads the vault's on-chain type to determine the exact package and coin type,
 * then validates that TREASURY_CAP_ID in .env can mint the right coin.
 * If the vault is from an older deployment, prints a clear re-provision message.
 */
import "dotenv/config";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { ownerKeypair, required, toBase } from "./script-helpers.js";

// Parse "0xPKG::vault::Vault<0xPKG::test_usd::TEST_USD>" → { vaultPkg, coinType }
function parseVaultType(typeStr: string): { vaultPkg: string; coinType: string } {
  const m = typeStr.match(/^(0x[0-9a-f]+)::vault::Vault<(.+)>$/);
  if (!m) throw new Error(`Unrecognized vault type: ${typeStr}`);
  return { vaultPkg: m[1], coinType: m[2] };
}

async function main() {
  const args = process.argv.slice(2);
  const vaultId = args[args.indexOf("--vault") + 1];
  const human   = args[args.indexOf("--amount") + 1];
  if (!vaultId || !human) throw new Error("Usage: --vault 0x.. --amount 100");

  const client = new SuiJsonRpcClient({
    url: process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443",
    network: "testnet",
  });

  // Read vault's actual on-chain type — don't assume env PACKAGE_ID matches
  const vaultObj = await client.getObject({ id: vaultId, options: { showType: true } });
  if (!vaultObj.data?.type) throw new Error(`Vault ${vaultId} not found on-chain`);
  const { vaultPkg, coinType } = parseVaultType(vaultObj.data.type);

  const envPkg      = required("PACKAGE_ID");
  const envCoinType = required("COIN_TYPE");
  const cap         = required("TREASURY_CAP_ID");

  if (vaultPkg !== envPkg || coinType !== envCoinType) {
    console.error(`\nType mismatch — vault is from an older deployment:\n`);
    console.error(`  Vault package:  ${vaultPkg}`);
    console.error(`  .env PACKAGE_ID: ${envPkg}\n`);
    console.error(`The vault must be re-provisioned with the new package.`);
    console.error(`To fix:`);
    console.error(`  1. Clear the stale vault record in MongoDB:`);
    console.error(`       mongosh "<MONGODB_URI>" --eval 'db.vaults.deleteMany({})'`);
    console.error(`  2. Sign in to the web app again — vault auto-provisions with new package.`);
    console.error(`  3. Copy your new vault ID from the dashboard and re-run this script.\n`);
    process.exit(1);
  }

  const kp     = ownerKeypair();
  const amount = toBase(human);

  const tx = new Transaction();
  const [minted] = tx.moveCall({
    target: `${vaultPkg}::test_usd::mint_coin`,
    arguments: [tx.object(cap), tx.pure.u64(amount)],
  });
  tx.moveCall({
    target: `${vaultPkg}::vault::deposit`,
    typeArguments: [coinType],
    arguments: [tx.object(vaultId), minted],
  });

  const r = await client.signAndExecuteTransaction({
    signer: kp,
    transaction: tx,
    options: { showEffects: true },
  });
  if (r.effects?.status.status !== "success") throw new Error(r.effects?.status.error);
  console.log(`Funded ${vaultId} with ${human} ${process.env.COIN_SYMBOL ?? coinType}. Digest: ${r.digest}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
