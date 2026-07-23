# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Move (on-chain)** — run from `move/`:
```sh
sui move build           # compile
sui move test            # all tests (24, all in vault_tests — incl. event-emission tests)
sui move test <test_fn>  # single test by name
```

**TypeScript / web** — run from repo root:
```sh
npm run dev              # Next.js dev server
npm test                 # Jest unit tests (39 total: decide 13 + principal-replay 13 + format 13)
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

`redeem_position` is the full-drain path ("move everything to Spend"): `withdraw_all` on the cTokens, position destroyed, emits `RebalanceEvent` (direction TOPUP, actual redeemed amount, `savings_value_after: 0`). Every balance-changing function emits — see the ledger-completeness invariant below.

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
- `/api/onramp/session` + `/api/offramp/{session,status,availability}` — Coinbase money-in/money-out. Offramp is a staged two-step (the sell widget gates on the WALLET balance at the session-token address): (1) in-app amount → withdrawToMe stages vault → wallet, (2) widget order → status API supplies exact sell_amount + deposit address → plain wallet send (coinWithBalance, server-built via `/api/sponsor` walletSend). `CashOutCard` drives it in the proposal slot; abandoned staging is recovered by the arrival proposal. Region header is a UI hint only — Coinbase is the eligibility authority

**Client components** (`components/`):
- `LiveDashboard` — renders `/api/state` data directly: no animation, values update instantly on poll. Both pockets floor to whole cents so Spend + Save always sums to Total; Save card shows accrued interest inline
- `ChatPanel` / `AsidePanel` — `useChat` → `/api/chat`; tab switcher mounts all panels with `display: none` to preserve state
- `ConfirmCard` — shows proposal details + "After this" effect rows; user taps Confirm → `executeTransaction` (user-signed, Shinami-sponsored)
- `SendSheet` — send flow; also owns contacts management (Manage → sub-view, save-as-contact prompt after sending to a raw address)
- `ReceivePanel` — shows zkLogin address + QR; detects owned `COIN_TYPE` coins and calls `vault::deposit`
- `AccountMenu` / `ProfileContent` — profile UI shared between the desktop avatar dropdown (`compact`) and the mobile BottomNav Profile tab
- `OnboardingModal` — shown once on first visit (localStorage flag)

**Earnings / cost basis (derived, never stored)**: savings principal is a pure fold over the on-chain `RebalanceEvent` stream, computed at read time by `getReplayedPrincipal()` in `lib/principal-replay.ts` — sweeps add, topups subtract (clamped at 0). The cache is layered per vault: memory on `globalThis` (warm instances) → Mongo `replay_checkpoints` (cold instances; written ONLY by the fold itself — one function caching its own output, never authoritative state) → full genesis replay on miss. A fresh checkpoint is trusted as-is; one older than 24h triggers a full replay that overwrites it (periodic verify). Missing/corrupt/stale rows self-heal — absence is a handled state. Zero principal writes exist outside this cache. `accrued = savingsValue − replayedPrincipal`, clamped at 0.

**Sponsor safety (gas-station guard)**: `/api/sponsor` only co-signs our own transaction shapes. Its generic branch validates EVERY command of the client-serialized PTB (`lib/sponsor-guard.ts`) — each must be a `TransferObjects` or a MoveCall to `<PACKAGE_ID|PACKAGE_ID_LATEST>::vault::{owner_send,withdraw,owner_rebalance,redeem_position,create_vault,deposit}`; a mixed PTB (one legit + one foreign call) fails. Both sponsor and submit-tx require auth and assert the tx sender is the session's own vault payout address (create_vault/provisioning is exempt — no vault row yet). deposit/walletSend PTBs are server-built with params pinned to the session vault + env, never the client body.

**Rate limiting**: `lib/rate-limit.ts` — one async `enforceRateLimit(req, bucket, limit, windowMs)` interface. Backend chosen at load: Upstash Redis sliding window (GLOBAL across serverless instances) when `KV_REST_API_URL` + `KV_REST_API_TOKEN` are set, else an in-memory window (per-instance/advisory, local dev). Fails OPEN on a backend error — a limiter must never take the API down. Applied to the unauthenticated proxies (salt, zkproof, sponsor, submit-tx, auth/session mint).

**Session auth (signed cookie)**: `cashpan-sub` is an HMAC-SHA256 sealed token `base64url({sub,address,exp}).sig` under `SESSION_SECRET`, NOT the raw Google sub (which was forgeable — CDP finding). Minted only after server-side Google id_token verification (`lib/google-id-token.ts`, RS256/JWKS); the zkLogin `address` is captured at mint from Shinami (`lib/shinami-zkwallet.ts`) so no route trusts a client-supplied address. If Shinami derivation fails, the mint fails (401) — never seal `{sub}` without an address. EVERY authed route verifies through the one helper `getAuthedSub(req)` / `getAuthedSession(req)` / `verifySessionCookie` in `lib/session.ts` — missing/forged/expired/address-less → clean 401. `SESSION_SECRET` must be set (Vercel env); rotating it, or this deploy itself, invalidates all existing sessions (one re-login, no dual-acceptance window).

**Vault registration is session-authoritative**: `/api/vault/register` IGNORES all client-supplied vault/ownerCap/payout ids — it binds `identityKey = session.sub` to the vault the session's authenticated `address` owns on-chain (`findOwnedOwnerCap`, retried for indexing lag). A session can never bind to a vault its address doesn't control (blocks the cross-user-read residual). The on-chain ownership lookup is the sole source of the bound ids.

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

- **Ledger completeness**: any Move function that changes a balance MUST emit an event with actual amounts (and `savings_value_after` when savings is touched). The entire off-chain layer derives from event-stream completeness — an unemitted move silently corrupts derived principal and activity history (`redeem_position` did exactly this pre-upgrade). New/changed entry functions require an emit + the Move event-emission test updated. Defense in depth: the principal fold clamps `basis ≤ savings_value_after` per event (`lib/principal-replay.ts`).
- **Sub-cent sweep flooring is expected**: a sweep's Save pocket lands a sub-cent below the swept amount (cToken mint floors), so ConfirmCard shows the sweep Save after-value with a `~` prefix. This self-heals via accrual — do NOT "fix" it further. Topup/spend rows are exact.
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

## Autopilot (Phase A — agent spine)

Opt-in, per vault, revocable instantly. `worker/` is a separate deployable
(Railway/Fly) running a **rules engine — no LLM anywhere on the path** (the
model never signs and never triggers signing). Loop: every 60s, load
autopilot-enabled vaults, run the SAME pure policy the app uses
(`computeProposals` in `lib/brain.ts` — one implementation, two callers), and
execute `vault::rebalance` with a scoped AgentCap.

- **Keys**: `AGENT_SECRET_KEY` lives ONLY in the worker env — NEVER in the
  Next.js/Vercel env. The app gets `AGENT_ADDRESS` (public) to mint the cap to.
  Env now, KMS later.
- **Gas**: the agent pays its own gas (Shinami sponsorship is for users only).
  Worker logs LOW GAS under 0.5 SUI. The agent-signed `rebalance` is
  deliberately NOT in the sponsor whitelist — sponsoring it would let anyone
  with a session drain the gas station.
- **VERIFIED against the deployed vault.move (do not re-derive from the spec)**:
  `issue_agent_cap(owner_cap, vault, ctx)` takes **no cap arguments**;
  `per_tx_cap`/`daily_cap` are Vault fields fixed at `create_vault` with **no
  setter** (`set_outflow_caps` only touches the OUTFLOW caps). Existing vaults:
  $50/tx, $200/day, immutable. The "daily" cap resets when the **Sui epoch**
  advances (`current_epoch > last_reset_epoch`), not on a calendar day.
  Therefore the user-chosen daily limit is a **worker-enforced soft cap**
  (`autopilot.dailyCapBase`, owner intent in Mongo); the chain caps are the
  hard bound.
- **Enable/disable** are owner-signed and sponsored (`issue_agent_cap` and
  `revoke` are whitelisted in `lib/sponsor-guard.ts`). Disable bumps
  `agent_nonce`, killing every outstanding cap instantly — the chain is the
  authority; the Mongo flag only stops the worker from trying.
- **One voice**: while autopilot is on, the app suppresses its own sweep/topup
  proposals and suggestion chips (arrival/add proposals unaffected). Manual
  Move always works; the 5-min per-vault-per-direction cooldown keeps the
  worker from immediately counteracting it.
- **Attribution** is an on-chain fact: rebalance events whose tx `sender` is
  the agent address render as "Autopilot swept/topped up" — never a stored label.
- **Deploy (Railway, repo-root)**: RAILWAY BUILDS THE BUNDLE — set in the
  service's dashboard Settings (dashboard values win over `railway.json`,
  which mirrors them for reference): Root Directory EMPTY (cleared), Build
  Command `npm ci && npm --prefix worker ci && npm --prefix worker run build`,
  Start Command `node worker/dist/index.js`, healthcheck `/healthz`. The
  bundle is built at deploy from source and is NOT committed (`worker/dist/`
  stays gitignored) — there is no stale-bundle failure mode, so never commit
  `dist/` or "fix" a deploy by pushing a locally built bundle.
  Root Directory must stay empty: `root=worker/` cannot see `lib/`, which the
  worker imports. `npm start` (tsx) is unchanged for local work.
  esbuild externals are only the ESM-safe deps (`@mysten/sui`, `mongoose`,
  `dotenv`); `@suilend/sdk` must be BUNDLED (its extension-less deep imports
  break plain Node ESM), which drags in CJS deps — hence the `createRequire`
  banner in the build script. Output must stay ESM (`@mysten/sui` is ESM-only).
- **Suspension**: 3 consecutive aborts on a vault sets `autopilot.suspended`;
  the app shows a pause notice and the owner must re-enable. Never retry-loop
  into gas burn.

## Autopilot Phase B — scheduled sends (standing orders)

"Send mom $20 every Friday": the LLM only AUTHORS policies (chat tool →
structured proposal → PolicyCard); it never executes, schedules, or signs.
After owner confirm, execution is deterministic (`worker/policies.ts`).

- **Chain boundary**: `agent_send` aborts unless the recipient is on the
  owner-signed allowlist (`add_payee`, sponsored + whitelisted) and within the
  OUTFLOW caps ($20/tx, $100/epoch, set at `create_vault`). A policy to an
  unlisted address cannot execute regardless of bugs above. `agent_send` is
  deliberately NOT sponsorable.
- **Exactly-once**: `policy_runs` (Mongo) is UNIQUE on (policyId, period) —
  the load-bearing piece. Execution protocol: claim (insert 'executing';
  dup-key = skip) → sign+submit → mark sent/failed. Period keys derive from
  the PURE `lib/policy-schedule.ts` (ISO week / YYYY-MM / 'once'; monthly
  29–31 clamp to month end; all UTC) — tested in `tests/policy-schedule.test.ts`.
- **Crash recovery**: 'executing' rows >10 min old are verified AGAINST CHAIN
  (SendEvent match on vault/recipient/amount since claim). Found → sent;
  verified-absent → retryable 'crash_recovered'; query failed → row is LEFT
  ALONE and re-verified next pass. THE RULE: when uncertain whether money
  moved, stop and surface — never resend on ambiguity.
- **Retries, same period only, no catchup**: insufficient_funds ≤3 attempts
  ≥1h apart (rebalance pass runs first each tick — topup composition is the
  only funding path); epoch_cap_wait retries ≥15min until the epoch rolls;
  chain aborts park the POLICY ('failed', owner must resume). Missed periods
  never roll forward.
- **Two doors, one pipeline**: chat `proposeRecurringSend` (guarded by
  `guardExactAmount` — the policy amount must BE a number the user typed) and
  SendSheet "Make it repeating" (`POST /api/policies {preview:true}`) both
  render the same PolicyCard; activation re-validates through the same
  `proposeRecurringSend()` server-side. Confirm shows every signing step
  honestly (enable Autopilot / approve recipient / active).
- **Visibility**: Standing orders list in AccountMenu (pause/delete,
  session-authed intent — chain caps still bound everything). Failures
  surface as a card in the proposal slot until acknowledged (server-side
  flag). Activity rows read "Autopilot sent…" from the on-chain `by_agent`
  fact, never a stored label.

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

## Release tagging (standing)
Releases are tagged from main (`vX.Y.Z`); tag before starting any major feature branch.

## Migration rule (standing)
Any change that adds a required/queried field to a Mongo schema, or changes the
semantics of an existing field (network scoping, etc.), MUST include a one-time
backfill for existing rows in the SAME commit. Adding a network-scoped query
without backfilling broke production. New field/semantics → backfill existing
data, always. Corollary: prefer deriving values from chain state on-read over
storing them — a derived value has no backfill, no drift, and no reconcile job
(see `lib/principal-replay.ts`).

## Package upgrades (standing)

The mainnet package has been upgraded once (v2, 2026-07-10: added the
`redeem_position` emit). Rules learned from that upgrade:

- **Two package ids after any upgrade.** `PACKAGE_ID` (env) is the ORIGINAL id —
  it identifies types and events forever (Sui defining-id semantics) and is used
  for all event filters. `PACKAGE_ID_LATEST` (env) is the newest package in the
  upgrade chain and is used for ALL `moveCall` targets — calls to the original id
  execute the OLD bytecode; there is no automatic routing. Code falls back to
  `PACKAGE_ID` when `PACKAGE_ID_LATEST` is unset. **After every upgrade, update
  `PACKAGE_ID_LATEST` locally AND in the Vercel env dashboard** — until then,
  production runs the previous bytecode.
- **Compatible upgrades cannot remove modules.** `test_usd` was deleted from the
  source tree during mainnet cleanup and had to be restored — it is part of the
  published package permanently. Do not delete Move modules that have shipped.
- **Procedure**: `sui client upgrade --upgrade-capability <cap> --dry-run .` first
  (from `move/`), then without `--dry-run`. The UpgradeCap is
  `0xb0ea4698ac0239e3ce634902d177d74ecfe71e33b51cdc51bb17425303c48f25`, owned by
  the deploy address. The CLI maintains `move/Published.toml` (original-id,
  published-at, version) — commit it after each upgrade. Do NOT add an
  `[addresses]` section to Move.toml; it flips the manifest to legacy mode and
  breaks the build against new-style deps.
- Per the standing dependency rule, any upgrade rides its own branch with full
  money-flow re-verification (simulation gate: one PTB sweep → redeem →
  `savings_balance`, assert emission + exact zero + original-id event type).

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


