# CashPan — POC v2 Spec: The Verbs (withdraw & send)

**One line:** Give the vault two money-*out* actions — `withdraw` (return funds to the owner) and `send` (pay an address) — so the loop is complete: save, earn, withdraw, send. These are the first paths that move money out of the vault, so the trust model is the point of this phase.

---

## The trust principle (the spine of this phase)

Every coin-out path is gated one of two ways:
- **OwnerCap → unrestricted.** The owner can withdraw anything and send anywhere. Full control, always.
- **AgentCap → pre-authorized destinations only, under separate outflow caps.** The agent can `withdraw` **only to the owner's stored payout address** (it cannot choose a destination) and can `send` **only to an address on the owner-managed allowlist** — each bounded by its own per-tx and daily outflow caps, and revocable by nonce like rebalance.

A compromised agent key can therefore, at worst, push capped amounts to the owner's own address or to addresses the owner already approved. It can never reach an arbitrary destination. That is the v0 no-withdraw guarantee, relaxed by exactly the amount the owner opts into — and no more.

---

## Scope discipline

**In scope:** the two verbs, owner + agent variants; owner-managed payout address and send-allowlist; separate outflow caps; events; Move tests; off-chain CLI scripts to exercise both on testnet.

**Deferred (do NOT build now):**
- The **autonomous trigger** — when the agent *decides* to send/withdraw — belongs to the chat phase. For now the verbs are invoked by the owner directly and by test scripts.
- **Confirm-above-threshold** — a chat/UX guard before signing, not an on-chain feature.
- Pulling outflow from savings. **Outflow comes from `liquid` only**; if liquid is short, topup first (existing rebalance) or owner redeems. Keeps each function single-purpose.

---

## Decisions / assumptions

- **Outflow caps are separate from rebalance caps**, and parallel in structure: `outflow_per_tx_cap`, `outflow_daily_cap`, `outflow_daily_spent`, plus the same daily-reset mechanism the rebalance caps already use. Rationale: leaving the vault is higher-risk than an internal shuffle, so the owner sets a tighter, independent limit ("rebalance freely, but only send up to X/day autonomously").
- **Allowlist:** `sui::vec_set::VecSet<address>` (small set, owner-managed). Owner add/remove.
- **Payout address:** a single `address` stored on the vault, set at creation, changeable by OwnerCap only. This is where agent `withdraw` always sends.
- Network: testnet. Asset: as configured.

---

## On-chain — `cashpan::vault` additions

**New vault state:**
- `payout_address: address`
- `allowlist: VecSet<address>`
- `outflow_per_tx_cap: u64`, `outflow_daily_cap: u64`, `outflow_daily_spent: u64` (+ reuse the existing daily-reset epoch tracking)

**Owner functions (OwnerCap-gated, unrestricted):**
- `owner_send<T>(owner_cap, vault, amount, recipient, ctx) -> ()` — splits `amount` from liquid, transfers to any `recipient`. No allowlist, no cap (owner is unrestricted).
- existing `withdraw<T>(owner_cap, vault, amount, ctx) -> Coin<T>` stays.
- `set_payout_address<T>(owner_cap, vault, addr)`
- `add_payee<T>(owner_cap, vault, addr)` / `remove_payee<T>(owner_cap, vault, addr)`
- `set_outflow_caps<T>(owner_cap, vault, per_tx, daily)`

**Agent functions (AgentCap-gated, scoped):**
- `agent_withdraw_to_owner<T>(agent_cap, vault, amount, ctx)` — transfers `amount` from liquid to `vault.payout_address`. The agent cannot specify a destination.
  - asserts: agent not revoked (nonce); `amount <= outflow_per_tx_cap`; `outflow_daily_spent + amount <= outflow_daily_cap`; `amount <= liquid` (else `EInsufficientLiquid`).
- `agent_send<T>(agent_cap, vault, amount, recipient, ctx)` — transfers `amount` from liquid to `recipient`.
  - asserts: not revoked; `vec_set::contains(&allowlist, recipient)` (else `ENotAllowlisted`); the same per-tx, daily, and liquid checks as above.
- Both update `outflow_daily_spent` (with daily reset) and emit an event.

**Events:** `WithdrawEvent { amount, to, liquid_after }`, `SendEvent { amount, to, liquid_after }`. Distinguish owner vs agent caller in the event (a flag or who-field) for the future trust feed.

**Invariant to preserve:** the existing rebalance path still moves liquid↔venue only and returns no coin; the only coin-out functions are the four above (two owner, two agent), each gated as specified. No new unguarded coin-out.

---

## Move tests (the trust proof)

- `agent_send` to an allowlisted recipient succeeds; to a non-allowlisted address aborts (`ENotAllowlisted`).
- `agent_withdraw_to_owner` lands at `payout_address`, not at any caller-chosen address.
- agent outflow over `outflow_per_tx_cap` aborts; cumulative over `outflow_daily_cap` aborts; daily counter resets next day.
- revoked AgentCap can neither `send` nor `withdraw` (nonce).
- outflow with `amount > liquid` aborts (no silent pull from savings).
- `owner_send` reaches an arbitrary (non-allowlisted) recipient — owner is unrestricted.
- allowlist add/remove and payout-address change are OwnerCap-only.
- all v0/v1 tests still green (rebalance caps, revoke, no-rebalance-drain, yield accrual).

---

## Off-chain — test scripts (so you can perfect it on testnet)

Two thin CLI scripts that build + submit and print the digest:
- `scripts/withdraw.ts` — owner withdraw, and agent `withdraw_to_owner` (flag to pick which cap signs).
- `scripts/send.ts` — owner send (any address), and agent `send` (allowlisted only), with the recipient as an arg.

No autonomous loop changes — `agent.ts`'s rebalance timer stays as-is. Verbs are user/script-triggered until the chat exists.

---

## Acceptance criteria

1. Owner can withdraw any amount and send to any address; owner manages payout address, allowlist, and outflow caps.
2. Agent `withdraw` only ever pays `payout_address`; agent cannot choose a destination.
3. Agent `send` only pays allowlisted recipients; non-allowlisted aborts.
4. Agent outflow respects separate per-tx and daily outflow caps (distinct from rebalance caps); daily resets.
5. Revoked agent can neither send nor withdraw.
6. Outflow is from liquid only; insufficient liquid aborts.
7. Events emitted for every withdraw and send, owner vs agent distinguishable.
8. No coin-out path exists outside the four gated functions; v0/v1 guarantees still green.
9. CLI scripts exercise owner and agent variants on testnet (digests for each).

---

## Build order

1. Vault state: payout address, allowlist, outflow caps + daily reset.
2. Owner setters + `owner_send`.
3. Agent `withdraw_to_owner` + `send` with all guards.
4. Events.
5. Move tests (the trust proof above).
6. `scripts/withdraw.ts` + `scripts/send.ts`.
7. Testnet exercise: owner withdraw, agent withdraw-to-owner, owner send, agent send to an allowlisted payee, plus the abort cases. Collect digests.

---

## After this

- **Real yield:** swap the simulated venue for Suilend / Sui Dollar behind the existing `YieldVenue` boundary (pending the testnet-reliability research).
- **The chat ("money talks"):** the LLM interprets "send mom $50," "give me $100 back," "how much have I earned" → routes to these verbs and to rebalance, with the confirm-above-threshold guard living here. LLM for intent only; the money path stays the capped, allowlisted, on-chain functions built in this phase.
