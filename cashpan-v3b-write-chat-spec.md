# CashPan — Phase 3b Spec: The Verbs Get a Voice (propose → confirm → execute)

**One line:** The chat can now move money — but only by turning your words into a structured *proposal* you must confirm with a tap, which then calls the capped, allowlisted Move verb. The LLM proposes; you approve; the chain enforces.

This is the highest-stakes phase. The architecture below is the point of it.

---

## The trust architecture (the spine — do not compromise it)

1. **The LLM never signs.** Its write tools *return structured proposals*; none of them sign or submit. Grep every LLM tool's `execute` for `signAndExecuteTransaction` / `Transaction` → none.
2. **Execution is a separate, human-triggered path.** A dedicated `/api/execute` endpoint is the *only* thing that signs, and it is **not** registered as an LLM tool — the model cannot call it. It runs only when you tap **Confirm**.
3. **Three layers of defense, on-chain is the backstop:**
   - UI confirmation card (you see and approve every move),
   - server re-validation in `/api/execute` (re-resolve recipient, re-check allowlist + caps + liquid from fresh on-chain reads before signing),
   - the Move functions themselves — they abort if a recipient isn't allowlisted or an amount is over cap, so even a tampered proposal can't exceed the on-chain guarantees.
4. **Agent cap only.** Chat money-moves sign with the **agent key** — the same capped, allowlisted, revocable key the autonomous loop already uses. The **owner key never touches the web server.** Owner-level actions (manage allowlist/caps, unrestricted send) stay in owner tooling, out of the chat.

---

## Scope discipline

**In scope:** intent → structured proposal; recipient resolution via payee labels (existing payees only); the confirmation card with a daily-remaining preview; the `/api/execute` signer (agent-cap, server re-validation); four money actions — `send` (→ `agent_send`), `withdraw`-to-me (→ `agent_withdraw_to_owner`), put-aside/sweep + move-to-spending/topup (→ `rebalance`); result display; **all 3a reads stay**.

**Deferred:** opt-in autonomous (no-confirm) sends with a threshold; payee management in-chat; owner-level unrestricted send via chat; client-side wallet signing / multi-user key handling; real yield.

---

## Decisions / assumptions

- Chat write actions map to **agent verbs only**; `/api/execute` signs with `AGENT_PRIVATE_KEY` (same as the loop). Owner key never imported or used in `app/` or `lib/`.
- **Recipient resolution:** an off-chain payee map (label → address) in config (e.g. `PAYEES` env or a small JSON). A label resolves *only if* its address is also on the **on-chain allowlist** (re-checked at execute). Unknown label, non-allowlisted address, over-cap, or insufficient liquid → the proposal carries the failure; no execute offered. **The LLM never invents an address.**
- **Every chat-initiated move requires an explicit Confirm tap.** No autonomous sends in 3b.
- Amounts parsed to smallest unit (MIST) internally; human units shown on the card.

---

## Components

### 1. Proposal tools (LLM-facing, no execution)
Add to the chat tool surface, alongside the 3a read tools:
- `proposeSend({ amount, payeeLabel })`
- `proposeWithdrawToMe({ amount })`
- `proposeSweep({ amount? })` (put aside / move to savings)
- `proposeTopup({ amount })` (move to spending)

Each **returns a structured proposal** computed from current on-chain reads, e.g.:
```
{ action: "send", amountMist, payeeLabel, recipient, 
  preview: { dailyOutflowRemaining, perTxCap, sufficientLiquid },
  blocked?: "not_a_payee" | "not_allowlisted" | "over_per_tx" | "over_daily" | "insufficient_liquid" }
```
They **do not sign**. If `blocked` is set, the card shows the reason and offers no Confirm.

### 2. Confirmation card (UI)
Renders the proposal in plain language: destination (label + truncated address), amount in human units, and cap context ("Daily send remaining: $150"). **[Confirm] [Cancel]**. Confirm → POST `/api/execute`; Cancel → discard, no side effect. Rendered inline in the conversation when a propose tool returns.

### 3. `/api/execute` — the only signer
- Accepts a proposal (action, amount, payee label / none).
- **Re-validates server-side from fresh on-chain reads:** re-resolve label → address, assert address ∈ on-chain allowlist, re-check per-tx + daily outflow caps and liquid. Reject mismatches.
- Builds the matching Move call — `agent_send` / `agent_withdraw_to_owner` / `rebalance` (sweep|topup) — signs with the agent key, submits.
- Returns digest + refreshed balances; surfaces any on-chain abort in plain language.
- **Not an LLM tool. The model cannot reach it.**

### 4. Chat integration
Keep the 3a read tools and Q&A. When a propose tool returns, render the card. After execute, refresh the activity feed and balances. The chat both answers and proposes; only your tap moves money.

---

## Acceptance criteria

1. Every LLM write tool returns a proposal only — no `signAndExecuteTransaction` / `Transaction` in any LLM tool's `execute`; signing exists solely in `/api/execute`.
2. `/api/execute` is the sole signer and is **not** registered as an LLM tool; the model cannot invoke it.
3. `/api/execute` re-validates (label → address, allowlist membership, caps, liquid) from fresh on-chain reads before signing.
4. Chat money-moves use the **agent cap only**; the owner cap/key is never imported or used in `app/` or `lib/` (grep clean).
5. "send mom $50" with mom allowlisted → confirm card → on Confirm, `agent_send` executes, digest returned, feed updates.
6. "send <unknown> $50" / non-allowlisted / over-cap → proposal shows the block reason; no Confirm; if somehow forced, the on-chain call aborts (backstop).
7. "give me $100 back" → `agent_withdraw_to_owner` to the payout address (not a chosen address); "put aside $200" / "move $50 to spending" → rebalance sweep/topup.
8. Every chat-initiated move requires an explicit Confirm tap; nothing executes on the model's say-so.
9. All 3a reads still work; Cancel discards with no side effect.

---

## Build order

1. Proposal tools + resolution/preview (reads only, no signing).
2. Confirmation card UI (renders proposal, Confirm/Cancel, block reasons).
3. `/api/execute`: server re-validation → agent-cap sign → submit → result.
4. Wire chat: propose → card → execute → refresh feed/balances.
5. Plain-language surfacing of failed resolution and on-chain aborts.

---

## Security note (honest, and load-bearing)

In 3b the web server signs with the **agent key** — the same capped, allowlisted, revocable key the autonomous loop already runs with; the owner key never touches the server. The on-chain caps and allowlist bound the blast radius even if the server is compromised. **Before any real users**, move to client-side wallet signing (the user's wallet signs each move) or a KMS — never hold user keys on a server in production. This is the line that has to change before CashPan leaves your own testnet wallet.

---

## After this

- **Opt-in autonomous sends** with a threshold (below auto-executes within caps, above asks) — for recurring "auto-pay mom monthly."
- **Payee management in-chat** (owner-gated add/remove, updating both the label map and the on-chain allowlist).
- **Client-side wallet signing / multi-user** — the production key model.
- **Real yield** — self-deploy Suilend to testnet to integration-test cTokens, then mainnet.
