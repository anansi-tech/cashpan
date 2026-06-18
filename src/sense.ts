import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { VaultState } from "./types.js";

export async function readVaultState(
  client: SuiJsonRpcClient,
  vaultId: string,
): Promise<VaultState> {
  const obj = await client.getObject({
    id: vaultId,
    options: { showContent: true },
  });

  if (obj.data?.content?.dataType !== "moveObject") {
    throw new Error(`Vault object ${vaultId} not found or wrong type`);
  }

  const fields = obj.data.content.fields as Record<string, unknown>;

  return {
    liquid: BigInt((fields.liquid as Record<string, string>).value ?? fields.liquid),
    savings: BigInt((fields.savings as Record<string, string>).value ?? fields.savings),
    perTxCap: BigInt(fields.per_tx_cap as string),
    dailyCap: BigInt(fields.daily_cap as string),
    dailySpent: BigInt(fields.daily_spent as string),
    agentNonce: BigInt(fields.agent_nonce as string),
  };
}
