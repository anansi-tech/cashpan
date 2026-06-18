export interface VaultState {
  liquid: bigint;
  savings: bigint;
  perTxCap: bigint;
  dailyCap: bigint;
  dailySpent: bigint;
  agentNonce: bigint;
}

export type Direction = "sweep" | "topup";

export interface Decision {
  action: Direction | "noop";
  amount: bigint;
}

export interface AgentConfig {
  rpcUrl: string;
  packageId: string;
  vaultId: string;
  agentCapId: string;
  agentPrivateKey: string;
  coinType: string;
  /** Desired liquid balance in base coin units. */
  buffer: bigint;
  /** Dead-band around buffer — no action if |liquid - buffer| <= band. */
  band: bigint;
  intervalMs: number;
}
