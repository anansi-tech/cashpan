# CashPan — Stable-Coin Migration Spec: De-SUI into a Configurable Stablecoin

**One line:** Move the entire system off SUI onto a **configurable stablecoin coin type** — default a 6-decimal **test USD** on testnet, real **USDC or Sui Dollar** by config flip for mainnet — without rewriting the on-chain core, which is already generic over `<T>`.

Nobody saves rent money in an asset that swings 20%. The product holds a stable dollar. This is the contained, certain block that unblocks identity and payees.

---

## The design goal (hold this above all)

**Stablecoin-agnostic.** Everything keys off three config values — `COIN_TYPE`, `COIN_DECIMALS`, `COIN_SYMBOL`. Switching between test USD, USDC, and Sui Dollar is a **config change, never a code change.** If switching coins requires editing code, the migration is wrong.

---

## The payoff of the generic core

`Vault<T>` and `YieldVenue<T>` are already generic. So:
- **Verify no `0x2::sui::SUI` (or any concrete coin type / 9-decimal literal) is hardcoded** in `move/sources/*.move`. If clean — and it should be — the vault and venue migrate with **zero contract changes.**
- The only new Move code is a test-coin module. Everything else is off-chain, config, scripts, and formatting.

---

## Scope discipline

**In scope:** a 6-decimal test stablecoin for reliable testnet testing; scripts that source the coin from *owned coins* (not gas); decimals/symbol-aware formatting in the read layer + UI; money amounts re-expressed as human decimals parsed via `COIN_DECIMALS`; fund vault liquid + venue reserve in the new coin; the full loop running on it.

**Deferred:** wiring real Circle USDC / Sui Dollar (it's the config flip — documented, not built, so the testnet build depends on no external faucet); sponsored gas / zkLogin (identity phase); the real yield venue.

---

## Decisions / assumptions

- **Testnet asset = a self-deployed 6-decimal test USD** (`test_usd`), mintable for funding, so testing is self-contained and reliable and proves 6-decimal handling (vs SUI's 9). Mainnet asset = real USDC or Sui Dollar via `COIN_TYPE`, with `test_usd` not deployed.
- **Gas stays SUI.** Sponsored gas (so users never hold SUI) is an identity-phase concern. For now scripts pay gas in SUI and move the *stablecoin* separately.
- **Money amounts live in config as human decimals** (`BUFFER=50`, `BAND=10`, `OUTFLOW_DAILY_CAP=100`, `INITIAL_FUND=200`) and convert to base units in **one shared loader** using `COIN_DECIMALS`. This kills the "off by 1000× decimals" footgun and makes the same `.env` valid across coin types.

---

## Components

### 1. `test_usd` Move module (testnet asset)
A `Coin` with **6 decimals** and a `TreasuryCap`-gated `mint` callable during setup/test funding. The controllable stand-in for USDC on testnet. Not deployed on mainnet.

### 2. Config + shared loader
- `COIN_TYPE` (full type tag), `COIN_DECIMALS` (6), `COIN_SYMBOL` ("USDC"/"USD").
- A single config module converts human-decimal amounts → base-unit bigints via `COIN_DECIMALS`, and formats base units → display via `COIN_DECIMALS` + `COIN_SYMBOL`. **One place** owns decimal↔base-unit conversion; nothing else hardcodes a decimal count.

### 3. Scripts — source the coin, not gas
- **Shared helper:** given an amount + `COIN_TYPE`, fetch owned coins (`getCoins`), merge to cover the amount, split the exact amount, return the coin argument. (For SUI you split from `tx.gas`; for a stablecoin you split from owned coin objects — this helper hides that.)
- `setup.ts`: publish vault + venue + `test_usd`; mint test USD; fund **vault liquid** and **venue reserve** with it; write IDs + config.
- `deposit.ts`, `send.ts`, `withdraw.ts`, `drain.ts`: use the helper for `COIN_TYPE` coins; gas still SUI.

### 4. Read layer + UI
Format every amount with `COIN_DECIMALS` + `COIN_SYMBOL` (USDC → `$X.XX`). Remove all SUI / 9-decimal assumptions from display and parsing.

### 5. Off-chain loop (sense / decide / act)
Unit-agnostic — `decide` compares raw bigints, `sense` reads balances, `act` passes `COIN_TYPE` as the type argument. **No logic change**; only the type arg and display decimals. Confirm it still runs.

---

## Acceptance criteria

1. No concrete coin type or 9-decimal literal hardcoded in `move/sources/*.move`; vault + venue unchanged. A new `test_usd` module exists (6 decimals + mint).
2. `COIN_TYPE` / `COIN_DECIMALS` / `COIN_SYMBOL` drive everything; switching stablecoins is config-only (grep: no hardcoded SUI type or `9`-decimal/`1e9` literal in any amount/format path across `src`, `lib`, `app`, `scripts`).
3. `.env` money amounts are human decimals, converted in one shared loader via `COIN_DECIMALS`.
4. Scripts source `COIN_TYPE` coins from owned coins (getCoins/merge/split), not gas; gas still SUI.
5. `setup` mints test USD and funds both vault liquid and venue reserve in it; the full loop — sweep, topup, withdraw, send, accrual — runs end-to-end on the 6-decimal coin.
6. Read layer + dashboard show amounts with the right decimals + symbol (`$X.XX`).
7. `decide` / `sense` remain unit-agnostic; all Move + `decide` tests green, with test amounts in 6-decimal units.
8. A documented "switch stablecoin" note: to run real USDC or Sui Dollar, set the three config values and skip the `test_usd` mint — no code change.

---

## Build order

1. `test_usd` module (6-decimal coin + mint); publish in `setup`.
2. Shared config loader (human-decimal ↔ base units via `COIN_DECIMALS`) + coin-sourcing helper.
3. Migrate scripts (`setup`, `deposit`, `send`, `withdraw`, `drain`) to the coin type + helper.
4. Read layer + UI decimals/symbol.
5. Re-express `.env` amounts; run the full loop on test USD; green all tests.
6. Write the stablecoin-switch note.

---

## After this

- **Identity + account model** — zkLogin sign-in *and* the per-user vault + scoped-key custody design (the architectural fork; not just a login button).
- **Payee management** — per-user, on-chain label+allowlist, built on the account model.
- **Real yield** — self-deploy Suilend to testnet → cTokens → mainnet, now denominated in the stablecoin.
