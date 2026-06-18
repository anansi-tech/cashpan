# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Move (on-chain)** — run from `move/`:
```sh
sui move build           # compile
sui move test            # all Move tests
sui move test <test_fn>  # single test by name (e.g. test_revoked_agent_cap_cannot_rebalance)
```

**TypeScript (off-chain)** — run from repo root:
```sh
npm test                 # Jest unit tests (decide.test.ts)
npm run setup            # publish + create vault + write .env (one-time)
npm run agent            # start the rebalance loop
```

## Architecture

This is a two-layer system: a Move smart contract (trust core) and a TypeScript off-chain agent that drives it.

### On-chain — `move/sources/vault.move`

A generic `Vault<T>` shared object holds two `Balance<T>` buckets: `liquid` and `savings`. Access is controlled by two capabilities:

- **`OwnerCap`** — full control (deposit, withdraw, issue/revoke agent cap). Never leaves the owner's wallet.
- **`AgentCap`** — scoped to `rebalance()` only. Carries a `nonce` that must match `vault.agent_nonce`; `revoke()` bumps that nonce, instantly invalidating all outstanding `AgentCap`s.

`rebalance(direction, amount)` enforces three on-chain guards in order: nonce validity → per-tx cap → daily cap (auto-resets when `ctx.epoch()` advances) → sufficient source balance. It emits `RebalanceEvent` on every call. There is no path from `AgentCap` to an arbitrary withdrawal address.

### Off-chain — `src/`

The agent runs a `sense → decide → act` loop with no LLM on the path:

- **`sense.ts`** — fetches `Vault` object fields via Sui RPC, returns typed `VaultState`
- **`decide.ts`** — pure function: `liquid > buffer + band` → sweep; `liquid < buffer` → topup (bounded by savings); else noop. Both sweep and topup are capped at `perTxCap` from the vault state.
- **`act.ts`** — builds a PTB calling `vault::rebalance` with the `AgentCap` object and submits it
- **`agent.ts`** — loads config from `.env`, runs the loop on `setInterval`, logs every tick

`scripts/setup.ts` is a one-shot deploy script: publishes the Move package, calls `create_vault`, issues an `AgentCap` to a freshly generated keypair, deposits an initial balance, and writes all IDs + the agent private key to `.env`.

### Key invariants

- The on-chain caps are the only safety boundary. A compromised agent key cannot exceed `per_tx_cap` per transaction or `daily_cap` per epoch, and cannot withdraw to any address outside the vault.
- `decide.ts` is a pure function — unit-tested in `tests/decide.test.ts`, zero I/O, no model imports anywhere on the loop path.
- The mock savings bucket (`vault.savings`) is the v0 yield venue stub. Swapping to a real venue (Scallop, Navi, etc.) means replacing the `savings` balance with a venue-specific call while keeping the same `rebalance` interface.
