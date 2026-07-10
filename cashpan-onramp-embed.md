# CashPan — Coinbase Onramp Embed (US funding)

**Spec for Claude Code. Branch `feat/onramp`.** Goal: a US user with a debit card
funds CashPan in one flow — no exchange, no SUI, no swaps. Card/ACH/Apple Pay →
USDC on Sui → their wallet → existing arrival strip takes over.

## Why this is small
Coinbase Onramp delivers native USDC **directly on Sui** to any address, zero fees
for USDC, Coinbase handles KYC/fraud/payments. Our destination = the user's zkLogin
wallet address. Everything after arrival ALREADY EXISTS (WalletArrivalStrip → Add →
Spend → agent proposes sweep). We are adding a doorway, not a system.

## David's prerequisites (not Claude Code)
1. Coinbase Developer Platform account → create project → get App ID + API key.
2. Apply for the zero-fee USDC onramp program (CDP dashboard request).
3. Confirm US availability config; note guest checkout (debit card, no Coinbase
   account needed) — verify current guest limits in CDP docs at build time.

## §1. Server: session/URL generation
- New route `POST /api/onramp/session` (authed): generates a One-Click-Buy URL or
  session token per current CDP Onramp docs (verify exact current API — session
  token vs URL params shifted over CDP versions; do NOT trust memory, read docs).
- Parameters: destination = session zkLogin address, blockchain `sui`, asset `USDC`,
  optional presetFiatAmount from user input. App ID from env `CDP_APP_ID`; any
  secret key stays server-side (`CDP_API_KEY`).
- Never accept a destination address from the client — always derive from the
  authenticated session server-side.

## §2. Client: "Add money" flow
- Receive panel (and empty-Spend state) gets primary button **"Add money"** with
  card/Apple Pay iconography. Existing QR/address view remains as secondary
  ("Receive crypto") — collapse it behind a toggle; crypto-native users find it,
  normal users never see an address.
- Tap → fetch session → open Coinbase Onramp (hosted URL in popup/new tab on
  desktop; redirect on mobile). No iframe hacks — use Coinbase's supported embed.
- On return/close: poll walletBalance (existing state poll covers it) — arrival
  strip appears when USDC lands; deposit proceeds through the EXISTING one-tap Add.
  Do not build a parallel post-onramp path.
- Copy: "Add money" / "Debit card, bank, or Apple Pay · arrives in minutes ·
  powered by Coinbase". Never say "Buy USDC" in primary UI.

## §3. Status + edge handling
- Onramp transactions can take minutes (ACH longer). Add a lightweight pending
  affordance: after onramp opens, show a dismissible "Waiting for your money to
  arrive…" note above the arrival strip slot. Clear when strip appears or on dismiss.
- If user cancels onramp: nothing to clean up (no state was created). 
- Min amount: Coinbase enforces its own minimums; surface their widget errors,
  don't pre-validate beyond > $0.

## §4. Offramp (fast-follow, same family — stub only now)
Coinbase Offramp (USDC → bank) is the exit story US users will ask about. Do NOT
build now; add `// offramp: same CDP integration family` note where session route
lives, and put "Cash out" on the roadmap. Trust requires a visible exit eventually.

## Acceptance
1. New US user: Google login → provision → "Add money" → $10 debit card → USDC
   lands at zkLogin address → arrival strip → Add → Spend shows $10 → agent
   proposes sweep per buffer/band → Save earning.
2. Zero new custody surface: destination is always the user's own address;
   server never touches funds; no new signing paths.
3. QR/manual receive still reachable (secondary).
4. `CDP_APP_ID`/`CDP_API_KEY` in env; no Coinbase values hardcoded.
5. Works on mobile viewport (redirect flow) and desktop (popup).

## Explicitly out of scope
Offramp execution, recurring buys, non-US payment methods, Caribbean corridor,
any change to vault/Move/yield paths.
