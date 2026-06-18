import type { VaultState, Decision } from "./types.js";

interface Rule {
  buffer: bigint;
  band: bigint;
  perTxCap: bigint;
}

/**
 * Pure decision function — no I/O, no LLM.
 *
 * - liquid > buffer + band  →  sweep (liquid - buffer), capped at perTxCap
 * - liquid < buffer         →  topup min(buffer - liquid, savings), capped at perTxCap
 * - else                    →  noop
 */
export function decide(state: VaultState, rule: Rule): Decision {
  const { liquid, savings } = state;
  const { buffer, band, perTxCap } = rule;

  if (liquid > buffer + band) {
    const excess = liquid - buffer;
    return { action: "sweep", amount: excess < perTxCap ? excess : perTxCap };
  }

  if (liquid < buffer) {
    const deficit = buffer - liquid;
    const available = savings < deficit ? savings : deficit;
    if (available === 0n) return { action: "noop", amount: 0n };
    return { action: "topup", amount: available < perTxCap ? available : perTxCap };
  }

  return { action: "noop", amount: 0n };
}
