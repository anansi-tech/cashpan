import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import type { Decision, AgentConfig } from "./types.js";

const DIRECTION = { sweep: 0, topup: 1 } as const;

export async function act(
  client: SuiJsonRpcClient,
  keypair: Ed25519Keypair,
  decision: Decision,
  config: AgentConfig,
): Promise<string | null> {
  if (decision.action === "noop") return null;

  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::vault::rebalance`,
    typeArguments: [config.coinType],
    arguments: [
      tx.object(config.agentCapId),
      tx.object(config.vaultId),
      tx.object(config.venueId),
      tx.pure.u8(DIRECTION[decision.action]),
      tx.pure.u64(decision.amount),
    ],
  });

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  });

  if (result.effects?.status.status !== "success") {
    throw new Error(
      `Rebalance tx failed: ${result.effects?.status.error ?? "unknown error"}`,
    );
  }

  return result.digest;
}
