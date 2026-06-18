# Money Agent — POC v0 Spec: Autonomous Liquidity Buffer

**One line:** An agent autonomously keeps a liquid buffer in your wallet and sweeps the rest to savings — on your own Sui wallet, non-custodial, capped, revocable, zero taps. This proves the sense → decide → act loop on an open rail. Nothing else.

This is the "money fridge." It is the thesis-proving core, not the product. Build it, prove it on your own testnet wallet, then layer the rest.

---

## Scope discipline (read first)

**In scope:** the loop only.
**Deferred (do NOT build now):** LLM intent-parsing, chat UI, real yield venue, on-ramp, multi-asset, multi-user, mainnet.

Simplest thing that works. No gold-plating. If a feature isn't required to prove "an agent moved my money with no tap, safely," it's out.

---

## Decisions / assumptions (each is a one-line change if wrong)

- **Network:** Sui testnet.
- **Asset:** a single fungible coin type, configurable (test USDC, or SUI for simplicity in v0).
- **Savings venue:** a **mock vault** (Move object) behind a `YieldVenue` boundary. Yield is zero/simulated in v0. Real venue (Sui Dollar / Scallop / Navi / Suilend) is a P1 swap.
- **Runtime:** Node/TS service + scheduler (Vercel Cron or a plain interval), reusing the existing stack.
- **Config:** hand-set JSON (buffer, band, asset, caps, object IDs). No LLM.
- **Repo:** new `anansi-tech/<name>` (pick a name; placeholder fine).
- **Move edition:** current Sui Move (2024 edition), current framework.

---

## On-chain — Move module (the trust core)

A `Vault` shared object holding two balances of the same coin type: `liquid` and `savings`.

**Capabilities (the non-custodial design):**
- `OwnerCap` — full control: deposit, withdraw any amount to any address, set the rule, revoke the agent. Held by the user only.
- `AgentCap` — scoped: may ONLY call `rebalance`, bounded by `per_tx_cap` and `daily_cap`. Cannot withdraw to an arbitrary address. Cannot exceed caps. Revocable.

**Entry functions:**
- `rebalance(agent_cap, vault, direction, amount)`:
  - assert the `AgentCap` is still valid (not revoked),
  - assert `amount <= per_tx_cap`,
  - assert `daily_spent + amount <= daily_cap` (reset counter on a new day/epoch),
  - move `amount` between `liquid` and `savings` per `direction` (sweep-to-savings or topup-from-savings; topup bounded by savings balance),
  - update `daily_spent`,
  - abort on any violation.
- `revoke(owner_cap, vault)`: invalidates the current `AgentCap` (bump a nonce/epoch on the vault that `rebalance` checks), so any existing agent key fails the validity assert.
- Owner-only: `deposit`, `withdraw`, `set_rule` (optional — rule can live off-chain in v0).

**Events:** emit on every `rebalance` (direction, amount, resulting liquid/savings balances). Needed later for the chat's trust feed.

---

## Off-chain — agent runtime

- **Sense:** read `Vault.liquid` and `Vault.savings` via Sui RPC.
- **Decide (pure function, unit-tested, NO LLM):**
  - `liquid > buffer + band` → sweep `(liquid - buffer)` to savings.
  - `liquid < buffer` → topup `min(buffer - liquid, savings)` from savings.
  - else → noop.
- **Act:** build + submit a PTB calling `rebalance` with the `AgentCap` signer. Never submit `> per_tx_cap` (chunk or defer). Respect the daily cap.
- **Schedule:** run every N minutes (Vercel Cron or interval). The loop path imports zero model code.
- **Key handling:** the agent signer is authorized only via `AgentCap`. Store via env for testnet. Document the security boundary: a compromised agent key can do nothing beyond capped wallet↔savings moves, and the owner can `revoke` instantly.

---

## Setup / seed script

One script: publish module → create `Vault` → mint `OwnerCap` to you → issue an `AgentCap` with `per_tx_cap`/`daily_cap` → fund the vault → write all object IDs + config to `.env`.

---

## Acceptance criteria (grep-able / provable by fresh clone)

1. Module exposes `OwnerCap`, `AgentCap`, `rebalance`, `revoke`; per-tx and daily caps asserted in `rebalance`.
2. `AgentCap` cannot withdraw to an arbitrary address — an out-of-scope call aborts (test present).
3. Over-cap `rebalance` aborts, both per-tx and daily (tests present).
4. `revoke()` makes a subsequent agent `rebalance` abort (test present).
5. Off-chain decision is a pure function with unit tests covering sweep / topup / noop boundaries.
6. Agent submits a real testnet tx; the scheduler triggers it; no model/LLM import anywhere on the loop path.
7. **End-to-end on a testnet explorer, zero manual rebalance txns:** fund `liquid` above buffer → agent sweeps the excess to savings (tx visible); withdraw to drop `liquid` below buffer → agent tops it back up (tx visible).
8. `rebalance` emits an event each time.

---

## Build order

1. Move module + Move tests (the trust core first).
2. Seed/publish script.
3. Off-chain sense → decide (pure) → act, with decision unit tests.
4. Scheduler.
5. End-to-end testnet demo, verified on explorer.

---

## After the loop works (the roadmap, not now)

- **P1:** swap `YieldVenue` mock → real (Sui Dollar / Scallop / Navi / Suilend); add LLM intent → config ("keep $50 liquid, save the rest" → params).
- **P2:** "money talks" chat — balances/earnings/Q&A in plain language, and narrate the agent's autonomous actions (the trust surface).
- **P3:** rent a fiat on-ramp (KYC/compliance outsourced) + lead with on-chain-native income (remittance/gig) so users rarely or never on-ramp.
