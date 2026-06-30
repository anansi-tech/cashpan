# CashPan — Polish Pass Spec

**One line:** Make the existing product feel like butter for a **non-technical, first-time user on a phone** — think Maria in Grenada, who has never used crypto or had a bank account and has no one to explain it. Today the app works but reads as a dev test harness. This pass closes that gap.

**Guiding principle:** polish toward *Maria*, not toward the operator who knows how it all works. Every screen must make sense with no explanation. If a step needs you to explain it, it's not done.

Three tiers — build in order. Tier 1 is functional completeness (the product is incomplete without it); Tier 2 is clarity and trust; Tier 3 is delight and cleanup.

---

## Tier 1 — Functional completeness

### 1. Transaction states (the Confirm → digest gap)
Right now there's likely a dead moment between tapping Confirm and the result. Add:
- **Pending:** an in-progress indicator ("Sending…" / "Moving your money…") the instant Confirm is tapped.
- **Success:** balances refresh, a brief clear confirmation, the activity feed updates.
- **Failure:** a plain-English message (not a raw error) with a **Retry**. Covers tx abort, sponsor failure, network drop.
No dead moments, no silent failures, ever.

### 2. Receive / Add money (the money-IN path)
There's currently no in-app way to fund a vault except the CLI. Add a **Receive** screen:
- Show the user's **zkLogin address + QR + copy** — "Share this to receive money." Coins sent here land in the user's wallet as owned coins.
- **"Add to CashPan"** action: detect owned `COIN_TYPE` coins in the wallet not yet in the vault, and offer to deposit them into the **Spend** pocket via the permissionless `deposit` (user-signed, sponsored).
- *Design note:* received money lands at the user's address first; "Add to CashPan" moves it into the vault. **Auto-detecting incoming funds and proposing the move is Block 3** — here it's a manual button. Do not invent a "send directly to the vault object" flow.

### 3. Empty state
A fresh $0.00 vault must show a friendly **"Add money to get started"** that points at Receive — not a bare row of zeros that leaves a first-timer stuck.

### 4. Mobile / responsive
The real users are on phones. Dashboard, chat, contacts, confirm card, and receive must all work on a narrow (~380px) screen with comfortable tap targets. This is must-have, not nice-to-have.

---

## Tier 2 — Clarity & trust

### 5. Onboarding (first run)
On first sign-in, a brief, warm explanation: you have a **Spend** pocket (money to use) and a **Save** pocket (money that grows), and here's how to add money. No wall of text — a one-time intro or inline hints.

### 6. Vocabulary sweep
- Every user-facing **"liquid" → "Spend"**; rename the `liquidSui` field to something coin-agnostic (`spendBalance`).
- Plain-English errors: `insufficient_liquid` → "Not enough in your Spend pocket"; `not_a_payee` already good.
- **Spend / Save / pockets / CashPan** consistent everywhere. No DeFi or bank jargon in any user-facing string.

### 7. Loading & error states
- Skeletons/placeholders while balances, contacts, and activity load — no blank-then-pop.
- Plain-English errors with retry for RPC / network / sponsor failures. Never surface a raw error.

### 8. Confirm-card feel
Calm and certain: action + amount + **real destination address** (for sends) + the resulting effect ("Spend → Save: $40"). A soft warning for unusually large amounts. Clear pending → done. This is the moment money moves; it should feel safe.

---

## Tier 3 — Delight & cleanup

### 9. Visual feel
The CashPan filling and the savings animation (the ticking tail) should feel smooth and alive, not janky. Reinforce the metaphor — money you tuck away, growing.

### 10. Chat feel
Streaming responses, a clear "thinking" state, a graceful "I didn't quite get that — try 'send mom $5'" when intent is unclear, warm plain-language answers.

### 11. Cleanup debts
- **Trim the phantom setup vault:** `setup` should publish package + venue + `test_usd`, mint the operator's test-USD stash, and print the `TreasuryCap` — and **stop creating/funding a vault** (vaults are born at sign-in; the setup vault just confuses).
- **Single-source decimals:** derive `NEXT_PUBLIC_COIN_DECIMALS` from `COIN_DECIMALS` (one source of truth) so a display/agent mismatch is impossible.
- **Dead env vars:** confirm `VAULT_ID` / `AGENT_PRIVATE_KEY` / `AGENT_CAP_ID` are absent from the web path (already true — keep it true).

---

## Acceptance — the butter test

A first-time user, on a phone, who has never used crypto or had a bank account, can: sign in → understand they have a **Spend** and a **Save** pocket → see how to add money (Receive) → and, once funded, put money aside / send / withdraw — with every action showing clear **pending → success/failure** feedback, in plain language, no "liquid," no raw addresses-as-jargon, no dead moments, no raw errors. Specifically:

1. Confirm → pending indicator → success (balances refresh) or plain-English failure with retry; no dead gap.
2. Receive shows address + QR + copy; "Add to CashPan" deposits owned coins into Spend (user-signed, sponsored).
3. Empty vault shows a friendly add-money prompt, not bare zeros.
4. Everything works on a phone-width screen with good tap targets.
5. No user-facing "liquid"; errors are plain English; Spend / Save / pockets / CashPan consistent.
6. First-run onboarding explains the two pockets without a wall of text.
7. Loading shows skeletons; errors show retry, never raw.
8. `setup` creates no phantom vault; decimals single-sourced; dead env vars gone from the web path.

---

## Build order

Tier 1 (states → receive → empty → mobile) → Tier 2 (onboarding → vocabulary → loading/errors → confirm card) → Tier 3 (visual → chat → cleanup).

---

## After this

The **e2e flow walkthrough** (click through as Maria would, end to end), then **Block 3** (propose-on-deposit brain — which makes the Receive "Add to CashPan" automatic), then **real yield** (Suilend).
