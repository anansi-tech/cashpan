# CashPan — Phase 3a Spec: Dashboard + Read-Only "Money Talks" Chat

**One line:** The real CashPan web app — a live dashboard that shows your two pockets (with savings animating upward) and an agent activity feed, plus a natural-language chat that answers questions about your money. **Nothing moves money in this phase.** Reads and talk only.

This is the safe, satisfying half. The verbs and confirmation come in 3b, on top of this.

---

## The non-negotiable invariant (the reason this is safe)

The LLM's entire tool surface in 3a is **read functions only**. No `send`, no `withdraw`, no signing, no `Transaction` — none of those tools are registered or importable in the chat path. The model can read state and answer; it has no capability to move money, by construction, not by instruction. This is the property that makes a talking money app trustworthy, and it must be enforced in code: the chat's tools file imports only the read layer.

Two more invariants:
- **The animated balance is display-only.** The chain is the source of truth for every real value; the UI interpolates between reads to feel alive, and never writes.
- **The web app holds no private keys.** 3a is read-only RPC. Nothing in this phase signs or submits a transaction. (Key handling arrives in 3b with owner-confirmed writes.)

---

## Scope discipline

**In scope:** Next.js web app in the existing repo; server-side read layer (reusing the accrual math from `src/`); live dashboard (two pockets, animated savings, total earned, APR, cashpan visual); agent activity feed from on-chain events; read-only LLM chat wired to the read layer.

**Deferred to 3b:** `send` / `withdraw` as write tools; intent → structured proposal parsing; the confirmation card (with daily-remaining); owner-key signing flow; confirm-above-threshold; autonomous sends. None of these exist in 3a.

**Out entirely for now:** multi-user / auth / wallet-connect (single vault from config, you are user zero); any database (on-chain is the data source — no Mongo).

---

## Architecture

- **Same repo** (`anansi-tech/cashpan`). Add a Next.js 15 App-Router app alongside the existing `move/`, `src/` (the autonomous rebalance loop), and `scripts/`. **Do not touch `move/` or the autonomous loop** — they keep running unchanged.
- **Stack:** Next.js 15 (App Router), Tailwind v4, shadcn/ui, Vercel AI SDK v5 + OpenAI, `@mysten/sui` 2.15.0 (`SuiJsonRpcClient` from `@mysten/sui/jsonRpc`, matching the existing code). No DB.
- **Config:** read the same `.env` the agent uses — package ID, vault ID, venue ID, `rate_bps`, `period_epochs`, buffer, band, caps. Single vault.
- **Read layer (server-side):** reuse `src/sense.ts` + the off-chain `computeCurrentValue` accrual so the app and the agent compute savings identically. Expose:
  - `getBalances()` → `{ liquid, savingsPrincipal, savingsValue, total }` (bigint→string)
  - `getEarnings()` → `{ accrued, totalEarned, aprBps }`
  - `getAgentActivity(limit)` → parsed on-chain events, newest first
  - `getConfig()` → `{ buffer, band, perTxCap, dailyCap, outflowPerTxCap, outflowDailyCap, payoutAddress }` (read-only)
  These are the **only** functions the chat may call.

---

## Components

### 1. Dashboard (the dopamine)
- **Two pockets as the cashpan:** liquid (spendable) and savings (the cow you're fattening). A visual of the pan filling as savings grows relative to a goal or simply over time.
- **Savings animates upward in real time:** compute a smooth projected value client-side from `savingsPrincipal`, `aprBps`, and elapsed wall-clock since the last read; **reconcile to `getBalances()` on each poll** (every ~3–5s) by easing toward the authoritative value (no jarring jumps).
  - *Honest caveat for testnet:* on-chain accrual is epoch-based, so the authoritative `savingsValue` only steps at epoch boundaries (~24h) while the UI animates continuously. The animation is a **projection** that reconciles at each poll. When real yield (Suilend cTokens) lands later, the authoritative value moves more continuously and the animation reconciles tighter. Build the easing so a projection-vs-truth gap is absorbed smoothly.
- **Total earned**, **current APR**, both pocket balances, all from the read layer.

### 2. Agent activity feed (the trust surface)
- Read on-chain events (`RebalanceEvent`, and any `WithdrawEvent`/`SendEvent` that exist) via the Sui SDK, newest first, rendered in plain language with relative timestamps:
  - sweep → "Moved $23 to savings"
  - topup → "Moved $15 back to spending"
  - (withdraw/send events, if present, similarly phrased)
- This is how a person sees the agent working before 3b ever asks them to approve a send.

### 3. Read-only LLM chat ("money talks")
- Vercel AI SDK v5 chat (streaming), OpenAI model, with a **tool surface of exactly the four read functions** above and nothing else.
- System prompt: CashPan's money assistant; plain, warm language for someone who is not crypto-savvy; answers about balances, earnings, and what the agent did; **states it cannot move money in this version** if asked to send/withdraw (because it has no such tool).
- Handles: "What's my balance?", "How much have I earned?", "What did the agent do this week?", "What's my setup?" — by calling the read tools and phrasing the result.
- The chat and dashboard are one surface: talk on one side, watch the money work on the other.

---

## Acceptance criteria

1. Next.js App-Router app runs in the repo; `move/` and the autonomous loop are unchanged.
2. Server read layer exposes `getBalances` / `getEarnings` / `getAgentActivity` / `getConfig`, reading on-chain and reusing the existing accrual computation (app and agent agree on savings value).
3. **Chat tool surface contains only those read functions.** No write/move-money tool is registered anywhere in the chat path; grep the chat path for `signAndExecute`, `Transaction`, `owner_send`, `agent_send`, `withdraw` → none present.
4. Chat answers balance / earnings / activity / config questions in plain language via the tools, and declines (gracefully) any request to move money.
5. Dashboard shows both pockets; savings animates upward between polls and reconciles to the on-chain value each poll; the animation writes nothing.
6. Agent feed lists recent on-chain events in plain language, newest first.
7. The web app loads no private keys and submits no transaction in 3a (read-only RPC).
8. Total earned, APR, and a cashpan-fill visual are present.

---

## Build order

1. Read layer: reuse `sense` + `computeCurrentValue`; implement the four read functions and route handlers/server actions.
2. Dashboard shell: two pockets, total earned, APR, cashpan-fill visual (static values first).
3. Live animation: poll `getBalances`, interpolate savings, reconcile with easing.
4. Agent feed from on-chain events.
5. Read-only chat: Vercel AI SDK with the four read tools + system prompt; wire to the UI.
6. Polish.

---

## Deferred to 3b (write side)

`send` / `withdraw` exposed as **write tools**; the LLM parses "send mom $50" / "give me $100 back" into a structured proposal; a **confirmation card** ("Send $50 to mom (0x…ab)? Daily send remaining: $150") that calls the capped, allowlisted Move verb **only on tap**; owner-key signing; confirm-above-threshold; later, opt-in autonomous sends. The model proposes, you approve, the chain enforces — built on the read surface this phase establishes.
