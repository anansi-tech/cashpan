# CashPan — Identity Epic, Block 3: The Proactive Brain (propose on deposit)

**One line:** The agent detects money arriving and **proactively proposes** putting it to work — "you received $50, add it to your CashPan?" and "you've got $50 in Spend, put $30 in Save?" — read-only, you confirm and sign. This makes CashPan feel agentic again and dissolves the manual wallet→vault step from the e2e.

---

## The non-custodial invariant (unchanged, load-bearing)

The brain **reads and proposes. It never signs.** Every resulting move is signed by the **user** via zkLogin (the existing `executeTransaction`). The brain holds no key. Adding this block adds **zero signing authority** — grep the brain/watcher path for any signing and find none.

---

## The two proposals it makes

1. **Add to CashPan** (wallet → Spend) — when the user's zkLogin **wallet** holds `COIN_TYPE` coins not yet in the vault. Confirm → user-signed sponsored `deposit`. *This dissolves the manual "Add to CashPan" friction from the e2e.*
2. **Put aside to Save** (sweep) — when **Spend** (liquid) is above buffer+band, via the existing pure `decide()`. Confirm → user-signed `owner_rebalance` (SWEEP). The original autonomous-sweep, now an Ask-me proposal.

(Topup — moving Save → Spend when Spend runs low — is optional; include only if it's free to add. Sweep + Add are the core.)

---

## Architecture — two layers, build in order

**Layer 1 (foundation): read-time proposals.** On app open / refresh, compute pending proposals from **current state** — wallet balance, and vault liquid vs buffer+band. This is the **correctness backstop**: a proposal can never be silently missed, because it's recomputed every time the user looks. It dissolves the friction with **zero background service** and is fully non-custodial. **Build this first.**

**Layer 2 (proactive): a scheduled watcher with a durable cursor.** A cron-style job iterating registered vaults, polling `DepositEvent`s since a **durable Mongo cursor**, pre-recording proposals so they're ready even before the user opens the app. Survives restarts (resume from cursor); never reprocesses or misses. Polling + cursor is the robust MVP — websocket `subscribe` is a latency optimization for later.

A dropped or missed event degrades to "shown on next open" (Layer 1), never "money ignored." That redundancy is the point.

---

## Scope discipline

**In scope:** read-time proposal computation (Add-to-CashPan + Sweep, reusing `decide()`); the proposal surface in the UI (clear, dismissible card → confirm → user-signed execute); the scheduled watcher + durable Mongo cursor.

**Deferred:**
- **Push / web / email notifications** — the watcher *records* proposals; pushing them out-of-app is a later layer.
- **Websocket `subscribe`** — polling + cursor first.
- **Auto-execute** — that's **Autopilot**: the brain proposes, never auto-acts. Deliberate over automatic.

---

## Decisions / assumptions

- The brain **never signs**; read + propose only; the user signs via the existing `executeTransaction`. Non-custodial preserved.
- **Wallet inflow detection** = the user's zkLogin address holds `COIN_TYPE` coins not in the vault. **Vault deposit detection** = `DepositEvent` (cursor) + the read-time liquid check.
- **Proposals are advisory and dismissible.** The user is never forced and nothing auto-executes.
- **Cursor** lives in Mongo (per the registry — per-vault or one global), storing the last-processed event id. The watcher is a **scheduled job**, not a long-running socket.

---

## Components

### 1. Proposal computation (read-time)
Given a vault + its wallet: if the wallet holds `COIN_TYPE` not in the vault → an **Add-to-CashPan** proposal; if liquid > buffer+band (`decide()`) → a **Sweep** proposal. Pure, reuses `decide()`.

### 2. Proposal surface (UI)
A prominent but **dismissible** card/banner: "You received $50 — add it to your CashPan?" / "Put $30 in Save?" → confirm → user-signed sponsored execute (`deposit` / `owner_rebalance`), reusing the existing confirm/execute flow and its pending→success/error states.

### 3. The watcher (proactive)
A scheduled job: iterate registered vaults (`listVaults`), `queryEvents(DepositEvent, after=cursor)`, record/update pending proposals in Mongo, advance the cursor. **Read-only.** Resumes from cursor on restart.

### 4. Durable cursor
Mongo, per the registry; last-processed event id. An event bookmark — no funds, no keys.

---

## Acceptance criteria

1. On app open, if the wallet holds `COIN_TYPE` not in the vault, an **Add-to-CashPan** proposal shows; confirm → user-signed sponsored `deposit` → funds land in Spend.
2. On app open, if Spend is above buffer+band, a **Put-aside-to-Save** proposal shows; confirm → user-signed sweep.
3. The brain/watcher path **never signs** — all execution is user-signed via `executeTransaction` (grep clean).
4. The watcher processes each `DepositEvent` once via a durable Mongo cursor; restarting it neither reprocesses nor misses.
5. **Read-time fallback:** with the watcher stopped, opening the app still surfaces the correct proposals.
6. Proposals are dismissible; nothing auto-executes; the user signs every action.
7. The manual "Add to CashPan" friction is dissolved — receiving money proactively proposes the deposit.

---

## Build order

1. Read-time proposal computation (Add-to-CashPan + Sweep, reusing `decide()`).
2. Proposal surface in the UI → confirm → user-signed execute.
3. Scheduled watcher + durable cursor (proactive pre-computation).
4. Verify: stop the watcher → read-time still works (fallback); run it → proposals appear proactively; cursor survives a restart.

---

## Security note

Block 3 adds **no signing authority**. The brain reads chain + wallet state and writes advisory proposals; the user signs every resulting move via zkLogin. The watcher holds no key; the cursor is just an event bookmark. The non-custodial property is fully preserved.

---

## After this

- **Real yield** — self-deploy Suilend to testnet → cTokens → mainnet, denominated in the stablecoin.
- **Autopilot** — opt-in: the brain's proposals auto-execute **within user-set caps** via a scoped `AgentCap` (the dormant caps/allowlist go live). The deliberate-over-automatic line, crossed only by explicit user choice.
- **Push notifications** — surface proposals out-of-app.
