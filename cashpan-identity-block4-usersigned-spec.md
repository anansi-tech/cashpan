# CashPan — Identity Epic, Block 4: User-Signed Money Moves (retire the server signer)

**One line:** Every money move — send, withdraw, sweep, topup — is now signed by the **user** with their `OwnerCap` via zkLogin, gas sponsored. The server's fund-moving agent key is **retired**. After this block, the server holds no key that can move user funds. Non-custodial, fully — including the write path.

Block 2 made auth and ownership non-custodial. This makes the *write path* non-custodial, which is the part that was still pending.

---

## The trust completion

The shape is unchanged — **LLM proposes → you confirm → execution happens** — but the executor changes: the confirm card stops calling the server's `/api/execute` (agent key) and starts triggering a **client-side, user-signed** transaction via the Block 2 `executeTransaction` (zkLogin signature + Shinami sponsor). The model still only proposes; you still tap to confirm; now *your* key executes, not the server's.

---

## Scope discipline

**In scope:** a Move `owner_rebalance` (owner-callable sweep/topup); swap `ConfirmCard` from `/api/execute` → client-side `executeTransaction` building **owner verbs**; update the propose preview (affordability, not cap-remaining); **retire** `/api/execute` + `lib/execute.ts` server-agent signing; **decommission** the autonomous-signing loop from the real-user path.

**Deferred:**
- **Block 3** — event brain (propose on deposit, read-only).
- **Autopilot** — opt-in `AgentCap` for hands-off action (where the dormant caps/allowlist become live guardrails again).
- Payee-management UI; on-chain payee labels.

---

## Decisions / assumptions

- **All user money moves = owner verbs** (`owner_send`, `withdraw`, `owner_rebalance`), **unrestricted on-chain** — it's the user's own money. You don't cap a person spending their own funds.
- **The guardrail is the confirm tap** (plus an optional large-amount soft warning), not an on-chain cap. The per-tx/daily caps and the allowlist stay in the contract but **dormant** — they're the Autopilot guardrail for the future opt-in scoped `AgentCap`.
- **Payee resolution ("mom" → address) is a UX convenience** for `owner_send`; there is **no on-chain allowlist gate** on owner actions, and the user can also send to a raw address they type.
- **Every move is sponsored** (Shinami) — the user never holds SUI, never sees gas.
- **After this block the server retains only the gas-sponsor key.**

---

## Components

### 1. Move — `owner_rebalance`
`owner_rebalance<T>(owner_cap: &OwnerCap, vault: &mut Vault<T>, direction, amount, ctx)` — OwnerCap-gated, **unrestricted** (no per-tx/daily caps), routing through the venue `deposit`/`withdraw` exactly like `rebalance`, emitting the same rebalance event. Mirror `rebalance`'s body, minus the cap/nonce asserts (owner is unrestricted), gated by `OwnerCap`. This is what lets the user sweep/topup their own funds, since they hold `OwnerCap`, not `AgentCap`.

### 2. `ConfirmCard` → client-side user-signed execute
On **Confirm**, build the owner-verb `Transaction` from the proposal client-side, run it through `executeTransaction` (zkLogin sign + Shinami sponsor), show the digest, refresh balances/feed. **No call to `/api/execute`.** `ownerCapId` + `vaultId` come from the resolved vault record.
- **send** → `owner_send(ownerCap, vault, amount, recipient)`
- **withdraw-to-me** → `withdraw(ownerCap, vault, amount)` → `tx.transferObjects([coin], userAddress)`
- **sweep** → `owner_rebalance(ownerCap, vault, SWEEP, amount)`
- **topup** → `owner_rebalance(ownerCap, vault, TOPUP, amount)`

### 3. Propose preview update
The proposal preview now shows **affordability** (liquid available for send/withdraw, savings available for topup) and payee resolution — **drop the cap-remaining context** (no caps apply to owner actions). The propose tools stay read-only; only the preview fields change.

### 4. Retire the server signer
Remove the `/api/execute` route and `lib/execute.ts` agent-key signing (or hard-disable behind a dev-only flag, off by default). No `AGENT_PRIVATE_KEY` signing reachable from the request or chat path.

### 5. Decommission the autonomous-signing loop
`src/agent.ts` no longer signs for real users — the server-side autonomous-rebalance model is the *Autopilot* product, deferred. Remove it from the product path (keep only as a dev/single-vault tool if useful). The propose-on-deposit brain is Block 3 and is **read-only**.

---

## Acceptance criteria

1. `owner_rebalance` exists — `OwnerCap`-gated, unrestricted, venue-backed sweep/topup, emits the rebalance event; Move tests cover sweep + topup + owner-only.
2. `ConfirmCard` Confirm triggers a **client-side user-signed** transaction via `executeTransaction`; it no longer calls `/api/execute`.
3. send / withdraw / sweep / topup all execute as **owner verbs signed by the user's zkLogin key**, gas sponsored; digests returned; feed + balances refresh.
4. `/api/execute` and `lib/execute.ts` agent-key signing are removed or hard-disabled — no `AGENT_PRIVATE_KEY` / `signAndExecuteTransaction` reachable from the request or chat path (grep clean).
5. **After this block the only server key is the Shinami gas sponsor** — no server path can move user funds (grep `app/`/`lib/` for fund-moving signing → none but the user-signed client path and the gas sponsor).
6. The autonomous-signing loop does not sign for real users (removed from the product path).
7. Owner actions are uncapped on-chain; the confirm tap is the guardrail; an optional large-amount warning is shown.
8. Every move is sponsored — the user never needs SUI for a money move.
9. The LLM still only proposes; the user still confirms; reads unchanged.

---

## Build order

1. Move `owner_rebalance` + tests.
2. Client-side `Transaction` builders for the four owner verbs.
3. Swap `ConfirmCard` to `executeTransaction` (drop `/api/execute`).
4. Update the propose preview (affordability).
5. Retire `/api/execute` + `lib/execute.ts`; decommission the autonomous-signing loop from the product path.
6. End-to-end: sign in → "send mom $5" → confirm → user-signed sponsored move → digest + feed update.

---

## Security note

This completes non-custodial. After Block 4 the server holds **only** a gas-sponsor key — it pays fees and cannot authorize transaction content. **No server path can move user funds.** The user signs every move with their `OwnerCap` via zkLogin; gas is invisible. The on-chain owner verbs are intentionally uncapped (the user's own money); the confirm tap is the human gate. The caps and allowlist remain in the contract, dormant, as the guardrail for the future opt-in **Autopilot**, where a scoped `AgentCap` acts hands-off within limits the user sets.

---

## After this

- **Block 3** — event brain: detect `DepositEvent` across vaults (durable cursor + read-time fallback), propose on deposit — read-only; the user signs to act.
- **Payee management** — on-chain labels (address + nickname as one atomic record), retiring the env payee map.
- **Real yield** — self-deploy Suilend to testnet → cTokens → mainnet.
- **Autopilot** — opt-in scoped `AgentCap` so the agent can act hands-off within user-set caps/allowlist (the dormant guardrails go live).
