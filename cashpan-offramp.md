# CashPan — Coinbase Offramp (Cash out to bank)

**Spec for Claude Code. Branch `feat/offramp`.** Goal: Spend → "Cash out" → USD in
the user's bank. Same CDP family as onramp (same key, same session-token endpoint,
same JWT auth) but the flow INVERTS: Coinbase tells US where to send; the USER
signs an on-chain send; Coinbase pays out fiat.

## STEP 0 — GATE: verify Sui offramp support (before any code)
Docs examples show base/ethereum. Call the Sell Config/Options API and confirm
USDC-on-**sui** is a supported offramp asset/network for US. 
- Supported → proceed.
- NOT supported → STOP, report. Fallback design (do not build without David's
  call): user withdraws USDC to their own Coinbase account (Sui deposit address)
  and sells there — degraded, mostly-manual. Decision point, not code.

## Flow (from CDP docs — verified current)
1. `POST /onramp/v1/token` (same endpoint as onramp; single-use, 5-min expiry) with
   the USER'S address — must be the address that will HOLD the funds being sold.
2. Open `https://pay.coinbase.com/v3/sell/input?sessionToken=…&partnerUserRef=…&redirectUrl=…`
   (popup/redirect exactly like onramp; reuse /onramp/callback relay).
3. User picks amount + bank in Coinbase widget → clicks "Cash out now".
4. We poll Offramp Transaction Status API by partnerUserRef → returns sell_amount,
   asset, network, **to_address** (Coinbase-managed deposit address).
5. We build the on-chain send: user's funds → to_address, EXACT amount/asset/network.
   User signs (ask-me pattern — this is a ConfirmCard). Coinbase validates
   from_address/to_address/amount/network/asset, then deposits fiat to bank.

## CashPan-specific design decisions

### D1. Where the funds come from (vault vs wallet)
Coinbase validates **from_address** = the address in the session token. Our money
sits in the VAULT; the user's tx sender is their zkLogin address. Build the send as
ONE PTB: vault withdraw (liquid) → transfer to to_address, signed by the user —
sender = zkLogin address = session-token address. VERIFY with a small real
transaction that Coinbase's from_address validation accepts this (Sui sender
semantics vs coin provenance). If it rejects, fall back to two steps:
withdraw-to-wallet, then plain send (two signatures — worse UX, still correct).

### D2. Amount source of truth
The user picks the amount IN THE COINBASE WIDGET (step 3), not in CashPan. Our
ConfirmCard (step 5) displays what the Status API returned: "Cash out $X to your
bank — send $X USDC to Coinbase?" Never let the user edit the amount at our step;
mismatch = failed validation. If Spend < sell_amount, block with the standard
insufficient-funds card before signing.

### D3. The 30-minute window
Offramp times out 30 min after "Cash out now". Late sends land as crypto in the
user's Coinbase account and the sell FAILS. Therefore: begin polling only after
widget return (their guidance: avoid immediate polling; exponential backoff), and
surface the ConfirmCard promptly with a visible validity note ("complete within
30 minutes"). If expired before signing: card becomes "This cash-out expired —
start again", no send possible.

### D4. Requirements copy (no guest checkout)
Offramp REQUIRES a Coinbase account with linked bank. Set expectation on the
Cash-out entry: "Cashing out uses your Coinbase account (free) — you'll sign in
or create one." Do not let users discover this inside the widget.

### D5. Price-drop edge
If value drops below "receive at least" after the send, Coinbase cancels and
deposits the CRYPTO to the user's Coinbase account (not back to CashPan). Show
this outcome from status polling honestly: "Coinbase couldn't complete the sale —
your USDC is in your Coinbase account." Rare for USDC (stable) but handle the
status.

### D6. clientIp
Their docs: do NOT blindly trust X-Forwarded-For. Keep current derivation but
note Vercel's `x-real-ip`/platform-verified header is the trustworthy source in
prod; dev fallback unchanged from onramp fix.

## UX (one voice, consistent with arrival consolidation)
- Entry: "Cash out" action in Send/Move sheet (or quick-actions row if space).
  Available from Spend only — if funds are in Save, the existing topup proposal
  path moves them first (agent may chain: "Move $X to Spend, then cash out?" —
  ONE card at a time, sequential, per the proposal-queue rule).
- Steps render as chat/proposal cards: (1) open Coinbase [external], (2) on
  return + status: ConfirmCard "Send $X USDC to Coinbase → $Y to your bank",
  user signs, (3) status card updates to paid-out / failed via polling.
- Activity: the on-chain send appears naturally via the ledger (it's an
  owner_send to to_address). Label it "Cashed out $X to bank" by recognizing
  the pending offramp context (off-chain label on a real ledger event — allowed;
  fabricating events is not).

## Server
- Reuse the JWT/session-token route pattern: `POST /api/offramp/session`
  (authed; address = session zkLogin address, server-derived).
- `GET /api/offramp/status?ref=` proxying the Status API (authed, exponential
  backoff client-side).
- partnerUserRef = stable per-user id (identityKey hash) — required for status
  lookup; do NOT use raw Google sub in a URL param.

## Acceptance
1. Step 0 config check documented in the PR (Sui offramp supported: yes/no).
2. Real $2 cash-out end to end: Spend → Coinbase widget → bank ACH initiated;
   ConfirmCard amounts match Status API; activity shows "Cashed out".
3. Expired-window path: wait out a session, verify graceful expiry card.
4. Insufficient-Spend path blocks before signature.
5. No secrets client-side; session address server-derived; grep clean.
6. Trust sheet updated: "You can always leave" gains "cash out to your bank
   from the app" — the exit story is now literal.

## Out of scope
Recurring cash-outs, PayPal payout, non-US, offramp from Save directly (always
via Spend), Coinbase-balance payment methods.
