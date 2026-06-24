import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { VaultState } from "./types.js";

interface VenueFields {
  rate_bps: string;
  period_epochs: string;
}

interface PositionFields {
  principal: string;
  entry_epoch: string;
}

function computeCurrentValue(
  position: PositionFields,
  venue: VenueFields,
  currentEpoch: bigint,
): bigint {
  const principal = BigInt(position.principal);
  const entryEpoch = BigInt(position.entry_epoch);
  const rateBps = BigInt(venue.rate_bps);
  const periodEpochs = BigInt(venue.period_epochs);
  const elapsed = currentEpoch > entryEpoch ? currentEpoch - entryEpoch : 0n;
  if (elapsed === 0n || principal === 0n || periodEpochs === 0n) return principal;
  const interest = (principal * rateBps * elapsed) / (10_000n * periodEpochs);
  return principal + interest;
}

export async function readVaultState(
  client: SuiJsonRpcClient,
  vaultId: string,
  venueId: string,
): Promise<VaultState> {
  const [vaultObj, venueObj, systemState] = await Promise.all([
    client.getObject({ id: vaultId, options: { showContent: true } }),
    client.getObject({ id: venueId, options: { showContent: true } }),
    client.getLatestSuiSystemState(),
  ]);

  if (vaultObj.data?.content?.dataType !== "moveObject") {
    throw new Error(`Vault object ${vaultId} not found or wrong type`);
  }
  if (venueObj.data?.content?.dataType !== "moveObject") {
    throw new Error(`Venue object ${venueId} not found or wrong type`);
  }

  const vaultFields = vaultObj.data.content.fields as Record<string, unknown>;
  const venueFields = venueObj.data.content.fields as VenueFields;
  const currentEpoch = BigInt(systemState.epoch);

  // savings_position is an Option<Position>: either null or {fields: {principal, entry_epoch}}
  const rawPos = vaultFields.savings_position as
    | null
    | { fields: PositionFields }
    | { vec: Array<{ fields: PositionFields }> };

  let savings = 0n;
  if (rawPos !== null) {
    // Option is represented as a vec in Sui object JSON when Some
    const posFields =
      "vec" in rawPos
        ? rawPos.vec[0]?.fields
        : (rawPos as { fields: PositionFields }).fields;
    if (posFields) {
      savings = computeCurrentValue(posFields, venueFields, currentEpoch);
    }
  }

  return {
    liquid: BigInt(vaultFields.liquid as string),
    savings,
    perTxCap: BigInt(vaultFields.per_tx_cap as string),
    dailyCap: BigInt(vaultFields.daily_cap as string),
    dailySpent: BigInt(vaultFields.daily_spent as string),
    agentNonce: BigInt(vaultFields.agent_nonce as string),
  };
}
