# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Move (on-chain)** — run from `move/`:
```sh
sui move build           # compile
sui move test            # all tests (40 total: 17 vault + 9 yield_venue + 14 test_usd)
sui move test <test_fn>  # single test by name
```

**TypeScript (off-chain)** — run from repo root:
```sh
npm test                 # Jest unit tests (decide.test.ts — 13 tests)
npm run setup            # one-shot deploy: publish + create venue + create vault + write .env
npm run agent            # start the rebalance loop
```

## Architecture

Two-layer system: a Move smart contract (trust core) and a TypeScript off-chain agent.

### On-chain — `move/sources/`

**`vault.move`** — `Vault<T>` is a shared object with two capability types:

- **`OwnerCap`** — full control (deposit, withdraw, issue/revoke agent cap). Never leaves the owner's wallet.
- **`AgentCap`** — scoped to `rebalance()` only. Carries a `nonce` that must match `vault.agent_nonce`; `revoke()` bumps that nonce, instantly invalidating all outstanding `AgentCap`s.

`rebalance(agent_cap, vault, venue, direction, amount, ctx)` enforces guards in order: nonce validity → per-tx cap → daily cap (auto-resets when `ctx.epoch()` advances) → sufficient source balance. It emits `RebalanceEvent` on every call. There is no path from `AgentCap` to an arbitrary withdrawal address.

Vault fields:
- `liquid: Balance<T>` — the spend pocket
- `savings_position: Option<Position>` — the savings pocket, as a position in the YieldVenue
- `venue_id: ID` — security check: `rebalance` and `redeem_position` assert the passed venue matches this ID (`EWrongVenue`)

**`yield_venue.move`** — `YieldVenue<T>` holds deposited principal and an interest reserve. A `Position` tracks `{principal, entry_epoch}`. Accrual formula: `interest = principal * rate_bps * elapsed / (10_000 * period_epochs)`. Partial withdrawals use pro-rata principal reduction. `// SWAP POINT` comments on `deposit`, `withdraw`, `current_value`, and `fund_reserve` mark where a real protocol (Scallop, Navi, etc.) plugs in.

### Off-chain — `src/`

The agent runs a `sense → decide → act` loop with no LLM on the path:

- **`sense.ts`** — fetches `Vault` + `YieldVenue` objects and current epoch in parallel; computes `current_value` locally (mirrors Move accrual formula) to populate `savings` in `VaultState`
- **`decide.ts`** — pure function: `liquid > buffer + band` → sweep; `liquid < buffer` → topup (bounded by savings); else noop. Both capped at `perTxCap`.
- **`act.ts`** — builds a PTB calling `vault::rebalance` with `[agentCapId, vaultId, venueId, direction, amount]`
- **`agent.ts`** — loads config from `.env`, runs the loop on `setInterval`, logs every tick

`scripts/setup.ts` is the one-shot deploy: publishes both Move modules, creates the `YieldVenue` and funds its reserve, creates the `Vault` bound to the venue, issues an `AgentCap` to a fresh keypair, deposits initial liquid, and writes all IDs + agent key to `.env`.

### Key invariants

- The on-chain caps are the only safety boundary. A compromised agent key cannot exceed `per_tx_cap` per transaction or `daily_cap` per epoch, and cannot withdraw to any address outside the vault.
- `decide.ts` is a pure function — unit-tested in `tests/decide.test.ts`, zero I/O, no model imports anywhere on the loop path.
- `vault.venue_id` is set at creation and immutable. The vault cannot be redirected to a different venue after deployment.
- The `YieldVenue` is a fixed-rate stub for testnet. `// SWAP POINT` marks the four functions to replace for mainnet yield integration.

### Sui-specific gotchas

**Option\<Position\> in object JSON** — Sui represents `Option<T>` as either `null` (None) or `{vec: [{fields: {...}}]}` (Some). `sense.ts` handles both shapes when reading `savings_position`.

**Balance field shape** — `Balance<T>` appears as a nested struct `{value: "123"}` in object JSON, not a plain number. `sense.ts` reads it as `BigInt((fields.liquid as Record<string, string>).value ?? fields.liquid)`.

**Keypair loading** — `ownerKeypair()` in setup iterates the full keystore at `~/.sui/sui_config/sui.keystore` and matches by `toSuiAddress() === activeAddress`. This is necessary when the keystore has multiple keys from other projects (e.g. Spice). The agent private key is stored as a Bech32 string (`suiprivk...`) written by `agentKeypair.getSecretKey()` and loaded via `Ed25519Keypair.fromSecretKey(bech32string)`.

**SuiClient API** — This repo uses `@mysten/sui` v2.15.0. `SuiClient` was removed; use `SuiJsonRpcClient` from `@mysten/sui/jsonRpc`.

## Switching stablecoins

Everything is driven by three `.env` values — **no code changes needed**:

| Variable | Testnet (default) | USDC | Sui Dollar |
|---|---|---|---|
| `COIN_TYPE` | `<pkg>::test_usd::TEST_USD` | `0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN` | TBD |
| `COIN_DECIMALS` | `6` | `6` | `6` |
| `COIN_SYMBOL` | `USD` | `USDC` | `USD` |

Also set `NEXT_PUBLIC_COIN_DECIMALS` and `NEXT_PUBLIC_COIN_SYMBOL` to the same values (for client-side rendering).

**To deploy on testnet with test_usd** (default): run `npm run setup` — it publishes the `test_usd` module, mints tokens to the owner, and writes all vars.

**To use USDC or Sui Dollar instead**: set the three vars above, fund the vault manually via `npm run deposit -- --amount <n>`, and skip the mint step. The vault, agent, and UI adapt automatically. The `test_usd` module is published but unused.

Human-decimal amounts (`BUFFER`, `BAND`) are always in whole units of the coin regardless of decimals — `BUFFER=50` always means "50 tokens".
