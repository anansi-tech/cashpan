# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Move (on-chain)** — run from `move/`:
```sh
sui move build           # compile
sui move test            # all tests (40 total: 17 vault + 9 yield_venue + 14 test_usd)
sui move test <test_fn>  # single test by name
```

**TypeScript / web** — run from repo root:
```sh
npm run dev              # Next.js dev server
npm test                 # Jest unit tests (24 total: decide 13 + principal-replay 11)
npm run setup            # publish Move package + create YieldVenue + mint test_usd + write .env
                         # NOTE: does NOT create a vault (vaults are provisioned per-user at sign-in)
npm run agent            # optional standalone rebalance loop (legacy; needs VAULT_ID etc. in .env)
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

### Web app — `app/` and `components/`

Next.js 15 App Router. The main page (`app/page.tsx`) is a server component that reads vault state, then mounts client components.

**Auth flow**: Google OAuth → `/auth/callback` → Shinami ZK proof → session stored in HTTP-only `cashpan-sub` cookie. Client reads the zkLogin address from `sessionStorage` via `getSession()`.

**Key API routes** (`app/api/`):
- `/api/state` — the polling endpoint: vault balances + earnings + activity + proposals + contacts + settings in one response; `VaultDataProvider` polls it every 5s (paused when the tab is hidden)
- `/api/vault/register` + `/api/vault/find-existing` — vault provisioning; `ProvisionVault` (client) first checks `find-existing` for an owned `OwnerCap` (idempotent — reuses orphaned vaults from failed retries), creates one on-chain only if none exists, then registers it in Mongo
- `/api/sponsor` + `/api/submit-tx` — server half of tx execution: build/resolve PTB, Shinami sponsorship, submit via GraphQL. Every hop validates its expected fields and fails loud with the real error (Move aborts surface verbatim)
- `/api/chat` — streams AI SDK responses (`gpt-5-nano`); exposes `propose*` tools that validate on-chain before returning proposals
- `/api/contacts` — GET/POST/DELETE contacts stored in MongoDB per user

**Client components** (`components/`):
- `LiveDashboard` — renders `/api/state` data directly: no animation, values update instantly on poll. Both pockets floor to whole cents so Spend + Save always sums to Total; Save card shows accrued interest inline
- `ChatPanel` / `AsidePanel` — `useChat` → `/api/chat`; tab switcher mounts all panels with `display: none` to preserve state
- `ConfirmCard` — shows proposal details + "After this" effect rows; user taps Confirm → `executeTransaction` (user-signed, Shinami-sponsored)
- `SendSheet` — send flow; also owns contacts management (Manage → sub-view, save-as-contact prompt after sending to a raw address)
- `ReceivePanel` — shows zkLogin address + QR; detects owned `COIN_TYPE` coins and calls `vault::deposit`
- `AccountMenu` / `ProfileContent` — profile UI shared between the desktop avatar dropdown (`compact`) and the mobile BottomNav Profile tab
- `OnboardingModal` — shown once on first visit (localStorage flag)

**Earnings / cost basis (derived, never stored)**: savings principal is a pure fold over the on-chain `RebalanceEvent` stream, computed at read time by `getReplayedPrincipal()` in `lib/principal-replay.ts` — sweeps add, topups subtract (clamped at 0). A per-vault checkpoint (global stream cursor + folded states) lives in memory on `globalThis`; it is a cache, not a source of truth — losing it just triggers a genesis replay (~1–2 GraphQL pages). Zero principal writes exist anywhere. If cold-start replay ever exceeds ~1s (event volume growth), swap the checkpoint to Mongo as a pure cache — same fold, same invariants. `accrued = savingsValue − replayedPrincipal`, clamped at 0.

**Session expiry (three-layer guard)**: `AuthProvider` on mount detects cookie-without-sessionStorage and forces clean sign-out; `execute-zklogin` dispatches `cashpan:session-expired` when the ephemeral key/proof is missing; `SessionGuard` proactively forces re-login when `currentEpoch` reaches the zkLogin `maxEpoch`. All paths converge on one handler: clear storage, delete cookie, redirect to SignIn with a flash message.

**Transaction execution**: `lib/execute-zklogin.ts` builds a PTB, gets a Shinami sponsor signature, adds the user's zkLogin partial sig, and submits. The server never touches the user's private key.

**Proposal layer** (`lib/propose.ts`): pure functions that read live vault state and return typed `Proposal` objects (or `{ blocked: reason }`). The chat route calls these; the client renders the result as a `ConfirmCard`.

**`VaultTxContext`** (`lib/vault-tx.ts`): `{ packageId, coinType, vaultId, ownerCapId, venueId, userAddress }` — threads server env vars + vault IDs from `page.tsx` through to client components for PTB building.

### Off-chain — `src/`

The agent runs a `sense → decide → act` loop with no LLM on the path:

- **`sense.ts`** — fetches `Vault` + `YieldVenue` objects and current epoch in parallel; computes `current_value` locally (mirrors Move accrual formula) to populate `savings` in `VaultState`
- **`decide.ts`** — pure function: `liquid > buffer + band` → sweep; `liquid < buffer` → topup (bounded by savings); else noop. Both capped at `perTxCap`.
- **`act.ts`** — builds a PTB calling `vault::rebalance` with `[agentCapId, vaultId, venueId, direction, amount]`
- **`agent.ts`** — loads config from `.env`, runs the loop on `setInterval`, logs every tick

`scripts/setup.ts` is the one-shot deploy: publishes both Move modules, creates the `YieldVenue` and funds its reserve, mints test_usd to the owner, and writes `PACKAGE_ID`, `VENUE_ID`, `TREASURY_CAP_ID`, `COIN_TYPE`, `COIN_DECIMALS`, `COIN_SYMBOL` to `.env`. It does **not** create a Vault — vaults are provisioned per-user on first sign-in (`ProvisionVault` → `/api/vault/find-existing` → `/api/vault/register`).

### Key invariants

- The on-chain caps are the only safety boundary. A compromised agent key cannot exceed `per_tx_cap` per transaction or `daily_cap` per epoch, and cannot withdraw to any address outside the vault.
- `decide.ts` is a pure function — unit-tested in `tests/decide.test.ts`, zero I/O, no model imports anywhere on the loop path.
- `vault.venue_id` is set at creation and immutable. The vault cannot be redirected to a different venue after deployment.
- The `YieldVenue` is a fixed-rate stub for testnet. `// SWAP POINT` marks the four functions to replace for mainnet yield integration.

### Sui-specific gotchas

**Option\<Position\> in object JSON** — Sui represents `Option<T>` as either `null` (None) or `{vec: [{fields: {...}}]}` (Some). `sense.ts` handles both shapes when reading `savings_position`.

**Balance field shape** — `Balance<T>` appears as a nested struct `{value: "123"}` in object JSON, not a plain number. `sense.ts` reads it as `BigInt((fields.liquid as Record<string, string>).value ?? fields.liquid)`.

**Keypair loading** — `ownerKeypair()` in setup iterates the full keystore at `~/.sui/sui_config/sui.keystore` and matches by `toSuiAddress() === activeAddress`. This is necessary when the keystore has multiple keys from other projects (e.g. Spice). For the standalone agent, the agent private key is stored as a Bech32 string (`suiprivk...`) and loaded via `Ed25519Keypair.fromSecretKey(bech32string)` — but setup no longer creates or writes agent keys; manage them manually if running the agent loop.

**SuiClient API** — This repo uses `@mysten/sui` v2.17.0. `SuiClient` was removed; use `SuiJsonRpcClient` from `@mysten/sui/jsonRpc` (server-side PTB resolution) or `SuiGraphQLClient` from `@mysten/sui/graphql` (reads, tx submission).

## Switching stablecoins

Everything is driven by three `.env` values — **no code changes needed**:

| Variable | Testnet (default) | USDC | Sui Dollar |
|---|---|---|---|
| `COIN_TYPE` | `<pkg>::test_usd::TEST_USD` | `0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN` | TBD |
| `COIN_DECIMALS` | `6` | `6` | `6` |
| `COIN_SYMBOL` | `USD` | `USDC` | `USD` |

`NEXT_PUBLIC_COIN_TYPE/DECIMALS/SYMBOL` are **derived automatically** from the above via `next.config.ts` — do not set them separately in `.env`.

**To deploy on testnet with test_usd** (default): run `npm run setup` — it publishes the `test_usd` module, mints tokens to the owner, and writes all three vars.

**To use USDC or Sui Dollar instead**: set the three vars above manually and skip the mint step. The vault, agent, and UI adapt automatically. The `test_usd` module is published but unused.

## UI layout rule (standing)
After any layout refactor (shell restructure, new column, tab changes), verify
EVERY feature has a reachable entry point on BOTH shells before committing.
Checklist — not assumption:

| Feature | Desktop entry point | Mobile entry point |
|---|---|---|
| Receive (QR) | QuickBtn → overlay | QuickBtn → overlay |
| Send | QuickBtn → overlay | BottomNav send / overlay |
| Chat | center column always visible | MobileChatBar |
| Profile (account, auto-save rule, sign out) | AccountMenu avatar dropdown | BottomNav Profile tab (`ProfileContent`) |
| Contacts | SendSheet → Manage | SendSheet → Manage |
| Activity detail | inline expand (≥1024px) | DetailDrawer sheet |

Three regressions from command-center refactor: Settings/Contacts unreachable
on desktop, Receive QR blank on desktop (address from `getSession()` raced),
Activity detail opened full-screen sheet on desktop. Fix pattern: features
removed from a layout must land somewhere else in the same commit.

## Migration rule (standing)
Any change that adds a required/queried field to a Mongo schema, or changes the
semantics of an existing field (network scoping, etc.), MUST include a one-time
backfill for existing rows in the SAME commit. Adding a network-scoped query
without backfilling broke production. New field/semantics → backfill existing
data, always. Corollary: prefer deriving values from chain state on-read over
storing them — a derived value has no backfill, no drift, and no reconcile job
(see `lib/principal-replay.ts`).

## Dependency pins (standing)

- `@mysten/sui@2.17.0` — pinned exactly; `@suilend/sdk@3.0.4` requires it.
- `@suilend/sdk@3.0.4` — latest as of pin date.
- Both deduped to a single `@mysten/sui` at the root level (verified with `npm ls`).
- `SuiGrpcClient` and `SuiGraphQLClient` share the same `BaseClient` interface;
  `SuilendClient.initialize()` accepts either. QuickNode port 9000 is native gRPC
  (HTTP/2, not gRPC-web) — use `SuiGraphQLClient` for SDK reads; use `@grpc/grpc-js`
  directly for streaming subscriptions.
- USDC reserve index in Suilend lending market: **7** (live-resolved via
  `findReserveArrayIndex(COIN_TYPE)` — do not hardcode in env).

Do NOT bump either package casually. Upgrading requires a dedicated branch +
full money-flow re-verification.

## Provider (standing)

QuickNode Sui Mainnet (SOC2/ISO, free tier):
- `SUI_GRAPHQL_URL` — full HTTPS URL for GraphQL reads and SuiGraphQLClient.
- `SUI_GRPC_HOST` — host:port (no protocol) for native gRPC, used by `@grpc/grpc-js`.
- `SUI_GRPC_TOKEN` / `SUI_GRPC_AUTH_HEADER` — provider auth (header name in env, not code).
- `SUI_RPC_URL` — QuickNode JSON-RPC URL; **unused** — the web path is fully on GraphQL.

Switching providers = change env values only, zero code changes.
