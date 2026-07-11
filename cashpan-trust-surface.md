# CashPan — Trust Surface ("Is this safe?")

**Spec for Claude Code. Branch `feat/trust`.** One screen + entry points. Copy is
the deliverable — implementation is trivial. Goal: a skeptical non-crypto friend
finds the answer to "who has my money?" inside the app, before depositing, without
texting David.

## Placement (three entry points, one sheet)
1. Sign-in page: quiet link under the Google button — "How CashPan keeps your money safe"
2. Onramp moment: small "Who holds my money?" link on the Add-money panel (highest-
   anxiety moment = the moment they pay)
3. Profile menu: "How CashPan works" row
All open the same sheet/modal. No new page/route needed unless sheet is awkward
on mobile.

## The sheet — copy verbatim (edit only for fit)

**Your money stays yours.**
CashPan never holds your money. When you sign in with Google, your own wallet is
created on the Sui network — only you can move money out of it. Every transfer
requires your approval. We can't touch it, freeze it, or lose it.

**Where the growth comes from.**
Savings are lent through Suilend, an on-chain lending market, in USDC — a digital
dollar backed 1:1 by Circle. Borrowers pay interest; you earn it. The rate is
variable (currently ~X%) and shown live — never a promise.

**You can always leave.**
Withdraw to your own wallet anytime, no permission needed. Everything is public
on the Sui blockchain — [View my account on-chain] links to the user's vault on
suivision (proof, not marketing).

**What this is not.**
CashPan is not a bank and deposits are not FDIC-insured. Smart-contract and market
risks exist. Don't save what you can't afford to lock up while you learn to trust it.

## Rules
- APR value pulled live from existing state (never hardcode).
- The suivision link uses the user's real vault id — the "see for yourself" proof
  is the whole point.
- The "not FDIC-insured" line is non-negotiable. Honesty is the differentiator vs
  X Money's 6%; do not soften it.
- Fifth-grade reading level. No words: blockchain-jargon (zkLogin, non-custodial,
  DeFi, protocol) in the copy — describe, don't name. "Sui network" and "Suilend"
  appear once each as proper nouns with plain-language framing.

## Acceptance
1. All three entry points open the sheet; mobile + desktop.
2. Live APR + live vault link render correctly.
3. Read the sheet aloud to one non-crypto person: they can answer "who holds the
   money" and "how do I get out" afterward. That's the test.
