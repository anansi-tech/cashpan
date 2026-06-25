# CashPan — POC v1 Spec: Real Yield via YieldVenue (Sui Dollar–ready)

**One line:** The savings pocket stops being an idle balance and starts earning. Funds swept to savings now sit in a `YieldVenue` and grow; a top-up returns principal **plus accrued interest**. Proven on testnet with a reserve-funded rate, with one documented swap to Sui Dollar (or a lending protocol) on mainnet.

This makes "it earns" true. It's the spine the chat and the verbs sit on, so it goes first.

---

## Scope discipline (read first)

**In scope:** the `YieldVenue` boundary; a real (reserve-funded, fixed-rate) on-chain venue; refactor the vault's `savings` from a raw balance into a venue-backed position; agent sweep = deposit, topup = withdraw-with-interest; off-chain `sense` reads accrued value.

**Deferred (do NOT build now):** the `send` / `withdraw`-to-me verbs (next phase — they move funds *out* of the vault and need their own caps), the chat/LLM, real SUSD/protocol wiring beyond the documented swap point, multi-asset.

Simplest thing that works. The boundary is the deliverable; the real protocol is a swap behind it.

---

## Why "simulated rate" is the honest real thing on testnet

There is no real economic yield on testnet. A venue that pays a fixed rate from a pre-funded reserve is the honest representation: funds genuinely move into a venue, value genuinely accrues over time, and a withdraw genuinely returns more than went in. That proves the architecture and the full agent flow today. Mainnet swaps the venue module for Sui Dollar (yield native to the unit) or Scallop / Navi / Suilend, implementing the same vault-facing signature.

---

## Decisions / assumptions (each a one-line change if wrong)

- **Network:** testnet. **Asset:** SUI (as v0) or a test coin; configurable `COIN_TYPE`.
- **Yield model:** fixed `rate_bps` per `period_epochs`; interest paid from a pre-funded reserve held in the venue.
- **Accounting:** per-vault `Position { principal, entry_epoch }`. `value = principal + accrued`.
- **Trust model is unchanged:** agent sweep/topup are **vault ↔ venue only**. No `AgentCap` path sends funds to an external address. `OwnerCap` can always redeem the full position back and withdraw.
- **Caps** apply to the **principal amount** the agent moves per sweep/topup (action size), exactly as in v0.

---

## On-chain — new module `cashpan::yield_venue` (the boundary)

A shared `YieldVenue<T>`:
- `pool: Balance<T>` — deposited principal,
- `reserve: Balance<T>` — funds interest payouts,
- `rate_bps: u64`, `period_epochs: u64`.

The interface the real venue will mirror (these four signatures are the boundary):
- `deposit<T>(venue, coin, ctx) -> Position` — adds principal; returns/extends a `Position`.
- `withdraw<T>(venue, position, amount, ctx) -> Coin<T>` — pays `amount` of *value*: principal portion from `pool`, interest portion from `reserve`, pro-rata; reduces the position. Aborts if `reserve` can't cover the interest (`EReserveInsufficient`).
- `current_value<T>(venue, position, ctx) -> u64` — read-only: `principal + accrued`.
- `fund_reserve<T>(venue, coin)` — setup: load the interest reserve.

Accrual: `value = principal + principal * rate_bps * elapsed_epochs / (10_000 * period_epochs)`, where `elapsed_epochs = ctx.epoch() - position.entry_epoch`.

Partial-withdraw simplification allowed for v1: on partial withdraw, pay pro-rata principal+interest, reduce `principal`, and reset `entry_epoch` to the current epoch for the remainder. Document it in a comment. (The share/exchange-rate model is the production shape; not required here.)

---

## Refactor — `cashpan::vault`

- Replace `savings: Balance<T>` with a venue `Position` (or a thin handle to it) stored in the `Vault`.
- `rebalance` **SWEEP**: split `amount` from `liquid`, `yield_venue::deposit` it, extend the position. Caps assert on `amount` as before.
- `rebalance` **TOPUP**: `yield_venue::withdraw(position, amount)` back into `liquid`. Caps assert on `amount` as before.
- `savings_balance` view returns `yield_venue::current_value(position)`.
- Owner recovery: `OwnerCap` can redeem the full position to `liquid` and `withdraw` — preserve the full-control guarantee.
- Keep everything else from v0 intact: `OwnerCap`/`AgentCap`, `revoke` nonce bump, per-tx + daily caps, no-withdraw-for-agent (type-level).
- Events: extend `RebalanceEvent` (or add a `YieldEvent`) to carry `value_after`. Keep it minimal.

---

## Off-chain (minimal delta)

- `sense`: `savings` now = `current_value` (principal + accrued) read from the venue/position.
- `decide`: **UNCHANGED** — still pure, still operates on `liquid` / `savings` numbers, no LLM.
- `act`: sweep/topup still call `rebalance`; if the `rebalance` signature is unchanged, `act.ts` is nearly untouched. Funds now route through the venue inside the Move call.
- `types`: add `Position` / value fields as needed.

---

## Setup / seed

Publish `vault` + `yield_venue` → create venue → `fund_reserve` with test coins → create vault → issue caps → fund liquid → write all IDs (incl. venue + position) to `.env`.

---

## Acceptance criteria (grep-able / provable)

1. `yield_venue` exposes `deposit`, `withdraw`, `current_value`, `fund_reserve`.
2. Vault `savings` is venue-backed — no idle `savings: Balance` holding principal; sweep deposits to the venue, topup withdraws from it.
3. `current_value` increases with elapsed epochs for a funded position (Move test advancing the epoch).
4. `withdraw` returns principal + accrued interest from the reserve; aborts when the reserve can't cover it (tests).
5. Trust preserved: no `AgentCap` path sends venue funds to an arbitrary address (type-level, as v0); `OwnerCap` can redeem the full position (test).
6. v0 guarantees still green: per-tx + daily cap aborts, revoke abort, no-agent-withdraw.
7. Off-chain: `sense` reads accrued value; `decide` unchanged and pure; **no LLM import on the loop path**.
8. End-to-end on testnet: sweep funds → advance epoch(s) → savings value has grown → topup/redeem returns **more than principal**. Provide tx digests.

---

## Build order

1. `yield_venue` module + Move tests (accrual over epochs, withdraw-with-interest, reserve-insufficient abort).
2. Refactor vault `savings` → venue position; keep caps/revoke/no-agent-withdraw; update tests.
3. Off-chain: `sense` reads `current_value`; `act` routes through the venue; `decide` untouched.
4. Setup funds the reserve.
5. Testnet demo with digests.

---

## The mainnet swap (documented boundary)

The real venue implements the same four signatures:
- **Sui Dollar:** savings held as SUSD; yield is native to the unit, so `current_value` reads the SUSD value and accrual comes from holding. No reserve needed.
- **Scallop / Navi / Suilend:** `deposit` returns a market receipt held by the vault; `current_value` reads the position; `withdraw` redeems principal + interest.

Swap = point the vault's deposit/withdraw/value calls at the real venue module and redeploy. List the exact call sites in a `// SWAP POINT` comment so it's a mechanical change.

---

## After this (the roadmap, not now)

- **Verbs:** `withdraw`-to-me and `send`-to-address — these move funds *out* of the vault, so each needs its own per-tx/daily cap, an optional destination allowlist, and a confirm step above a threshold. The leash stays short.
- **Then the chat ("money talks"):** LLM for intent and explanation only — understands "put aside $200," "how much have I earned?", "send $50" — while the money path stays dumb arithmetic with on-chain caps. The chat decides what you meant; the vault enforces what's allowed.
