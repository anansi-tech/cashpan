/**
 * Shared helpers for all cashpan scripts.
 *
 * - required()      — read a required env var
 * - ownerKeypair()  — load the active Sui address keypair from the local keystore
 * - coinArg()       — produce a split-coin PTB argument for any COIN_TYPE
 *                     (for SUI: splits from gas; for non-SUI: fetches + merges owned coins)
 */

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import type { TransactionObjectArgument } from "@mysten/sui/transactions";

const SUI_TYPE = "0x2::sui::SUI";

export function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export function ownerKeypair(): Ed25519Keypair {
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

/**
 * Returns a coin argument for `amount` base units of `coinType`.
 *
 * SUI: splits from the gas coin (standard PTB pattern).
 * Non-SUI: fetches owned coin objects, merges if needed, splits exact amount.
 * Gas always remains SUI regardless of coin type.
 */
export async function coinArg(
  client: SuiJsonRpcClient,
  tx: Transaction,
  owner: string,
  coinType: string,
  amount: bigint,
): Promise<TransactionObjectArgument> {
  if (coinType === SUI_TYPE) {
    const [coin] = tx.splitCoins(tx.gas, [amount]);
    return coin;
  }

  const result = await client.getCoins({ owner, coinType, limit: 50 });
  if (!result.data.length) {
    throw new Error(
      `No ${coinType} coins found for ${owner}. Mint or transfer some first.`,
    );
  }

  // Sort largest-first to minimize merges
  const sorted = [...result.data].sort(
    (a, b) => Number(BigInt(b.balance) - BigInt(a.balance)),
  );

  const total = sorted.reduce((s, c) => s + BigInt(c.balance), 0n);
  if (total < amount) {
    throw new Error(
      `Insufficient ${coinType} balance: have ${total}, need ${amount}`,
    );
  }

  const primary = tx.object(sorted[0].coinObjectId);
  if (sorted.length > 1) {
    tx.mergeCoins(
      primary,
      sorted.slice(1).map((c) => tx.object(c.coinObjectId)),
    );
  }

  const [coin] = tx.splitCoins(primary, [amount]);
  return coin;
}
