import { decide } from "../src/decide.js";
import type { VaultState } from "../src/types.js";

const BUFFER = 1_000n;
const BAND = 100n;
const PER_TX_CAP = 500n;

function state(liquid: bigint, savings: bigint): VaultState {
  return {
    liquid,
    savings,
    perTxCap: PER_TX_CAP,
    dailyCap: 2_000n,
    dailySpent: 0n,
    agentNonce: 0n,
  };
}

const rule = { buffer: BUFFER, band: BAND, perTxCap: PER_TX_CAP };

// ============ Noop zone ============

test("noop when liquid equals buffer", () => {
  const d = decide(state(BUFFER, 500n), rule);
  expect(d.action).toBe("noop");
  expect(d.amount).toBe(0n);
});

test("noop when liquid is within band above buffer", () => {
  const d = decide(state(BUFFER + BAND, 500n), rule);
  expect(d.action).toBe("noop");
  expect(d.amount).toBe(0n);
});

test("noop when liquid is one unit below band threshold (edge)", () => {
  // liquid = buffer + band - 1 is still in the noop zone (not > buffer + band)
  const d = decide(state(BUFFER + BAND - 1n, 500n), rule);
  expect(d.action).toBe("noop");
  expect(d.amount).toBe(0n);
});

// ============ Sweep ============

test("sweep when liquid exceeds buffer + band by 1", () => {
  const liquid = BUFFER + BAND + 1n;
  const d = decide(state(liquid, 0n), rule);
  expect(d.action).toBe("sweep");
  // amount = liquid - buffer = BAND + 1
  expect(d.amount).toBe(BAND + 1n);
});

test("sweep amount is capped at perTxCap", () => {
  // liquid is very high — excess > perTxCap
  const d = decide(state(BUFFER + PER_TX_CAP + BAND + 500n, 0n), rule);
  expect(d.action).toBe("sweep");
  expect(d.amount).toBe(PER_TX_CAP);
});

test("sweep exact excess under perTxCap is not capped", () => {
  // excess = 200 > BAND = 100, so liquid = buffer + excess triggers sweep.
  // sweep amount = liquid - buffer = excess (not capped since excess < perTxCap).
  const excess = 200n;
  const liquid = BUFFER + excess;
  const d = decide(state(liquid, 0n), rule);
  expect(d.action).toBe("sweep");
  expect(d.amount).toBe(excess);
});

// ============ Topup ============

test("topup when liquid is below buffer and savings available", () => {
  const d = decide(state(BUFFER - 200n, 1_000n), rule);
  expect(d.action).toBe("topup");
  expect(d.amount).toBe(200n); // deficit = 200, savings > deficit
});

test("topup bounded by savings when savings < deficit", () => {
  const deficit = 500n;
  const savings = 300n; // less than deficit
  const d = decide(state(BUFFER - deficit, savings), rule);
  expect(d.action).toBe("topup");
  expect(d.amount).toBe(savings);
});

test("topup amount capped at perTxCap", () => {
  // deficit = 800 > perTxCap = 500
  const d = decide(state(BUFFER - 800n, 10_000n), rule);
  expect(d.action).toBe("topup");
  expect(d.amount).toBe(PER_TX_CAP);
});

test("noop when liquid below buffer but savings is zero", () => {
  const d = decide(state(BUFFER - 100n, 0n), rule);
  expect(d.action).toBe("noop");
  expect(d.amount).toBe(0n);
});

// ============ Boundaries ============

test("sweep triggers at exactly liquid = buffer + band + 1", () => {
  const d = decide(state(BUFFER + BAND + 1n, 0n), rule);
  expect(d.action).toBe("sweep");
});

test("topup triggers at exactly liquid = buffer - 1", () => {
  const d = decide(state(BUFFER - 1n, 100n), rule);
  expect(d.action).toBe("topup");
  expect(d.amount).toBe(1n);
});

test("zero liquid with savings triggers topup up to perTxCap", () => {
  const d = decide(state(0n, 2_000n), rule);
  expect(d.action).toBe("topup");
  // deficit = buffer = 1000 > perTxCap = 500
  expect(d.amount).toBe(PER_TX_CAP);
});
