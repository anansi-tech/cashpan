# CashPan — Autopilot Phase B (scheduled sends)

**Spec for Claude Code. Branch `feat/policies`. No merge without David's signed
end-to-end.** Goal: "send mom $20 every Friday" — typed once in chat OR built in
a form, confirmed once, executed forever by the worker. This is the policy
engine; Phase C (conditional rules) adds trigger types to the same engine.

## First principles (binding)
- The LLM AUTHORS policies (translates intent → structured object shown as a
  card). It never executes, never schedules, never signs. After owner confirm,
  execution is deterministic.
- Sends only to the ON-CHAIN ALLOWLIST. Adding a recipient is owner-signed
  (existing `agent_send` gating — verify exact allowlist entry function against
  vault.move; do not guess). A policy to an unlisted address cannot execute —
  chain refuses regardless of bugs above.
- Exactly-once per period. Sends are not self-correcting like rebalances —
  the durable idempotency ledger is the load-bearing piece of this phase.
- One card at a time; existing proposal-slot rules unchanged.

## B1. Policy schema (Mongo `policies` collection — owner intent, storing correct)
{ _id, vaultId, network, type: 'scheduled_send',
  recipient: { address, label },            // label from contacts
  amountBase: string,                        // fixed amount v1; no % or "rest"
  schedule: { kind: 'weekly'|'monthly'|'once', dayOfWeek?, dayOfMonth?, timeUTC },
  status: 'active'|'paused'|'ended'|'failed',
  createdAt, lastRunPeriod?: string,         // e.g. '2026-W31' / '2026-08'
  endAt?: date, note?: string }
- Period key derivation is pure + tested: (schedule, date) → period string.
  Monthly day 29–31 clamps to month end. All times UTC; display local.
- Cap sanity at creation: reject if amountBase > on-chain per_tx_cap ($50) —
  tell the user the real limit. Warn (not block) if monthly total across
  active policies could exceed daily/epoch cap interactions.

## B2. Durable idempotency ledger (Mongo `policy_runs`)
{ policyId, period, status: 'executing'|'sent'|'failed', digest?, amountBase,
  startedAt, error? } — UNIQUE index (policyId, period).
- Execution protocol: insert (policyId, period, 'executing') — duplicate-key
  = another run owns it, skip. Then build+sign+submit `agent_send`. On success
  update status 'sent'+digest; on failure 'failed'+error.
- Crash between insert and submit: on restart, 'executing' rows older than
  10 min are verified AGAINST CHAIN (query agent-sent events for that period/
  amount/recipient) before any retry — never re-send on ambiguity; mark
  'failed' + surface to owner instead. State the rule in code comments:
  when uncertain whether money moved, STOP and ask, never resend.

## B3. Worker execution
- Each loop tick: for active policies, compute current period; if no
  policy_runs row for (policy, period) and scheduled time passed → execute
  via protocol above.
- Funding: sends draw from LIQUID (Spend). If insufficient: first let the
  existing rebalance logic run (autopilot may topup from Save within caps —
  natural composition, no special path); re-check; still short → mark run
  'failed' (insufficient_funds), notify owner (B5), retry window = same
  period only, max 3 attempts spaced ≥1h, then failed for the period. Never
  roll a missed period into the next (no double-pay catchup in v1).
- Respect epoch caps: a send that would exceed remaining epoch cap waits for
  rollover WITHIN its period window, else fails-for-period with cap reason.
- Suspend semantics: policy-level 'failed' after repeated errors; vault-level
  autopilot suspension (Phase A) also pauses all its policies.

## B4. Authoring — two doors, one pipeline (mirrors Move form precedent)
- CHAT: model gets a `createPolicy` tool (schema-constrained; amount REQUIRED,
  recipient must resolve to an existing contact or explicit address). Tool
  result renders a PolicyCard: plain-language sentence ("Every Friday, send
  $20.00 to mommy — starts Aug 1, no end date") + [Confirm] [Cancel].
  The guard pattern from the misparse fix applies: policy amount must match
  a number in the user's message when one exists.
- FORM: Send sheet gains "Make it repeating" → same fields → same PolicyCard.
- Confirm (session-authed) activates the policy. IF recipient not yet on the
  on-chain allowlist: the confirm flow FIRST runs the owner-signed allowlist
  add (existing pattern), THEN activates — one flow, two steps shown honestly
  in the card ("① Approve mommy as a recipient (sign) ② Policy active").
- Recipient labels come from contacts; pasted raw addresses reuse the
  save-as-contact flow.

## B5. Management + visibility
- "Standing orders" section (Profile or Send sheet): list active policies as
  sentences + next-run date; per-policy Pause / Delete (session-authed —
  chain caps still bound everything; pausing is intent, not security).
- Every executed send: activity row "Autopilot sent $20.00 to mommy" (sender-
  attribution as Phase A) + policy linkage in the detail drawer.
- Failure notify: v1 = prominent in-app card ("Couldn't send mommy's $20 —
  not enough in Spend") persisting until acknowledged. Email/push out of scope.
- Chat can answer "what are my standing orders?" (read tool over policies).

## B6. Out of scope (Phase C+)
Conditional triggers, percentage/"whatever's left" amounts, catchup for missed
periods, multi-recipient policies, pausing individual periods, email/push,
policy templates, cross-vault.

## Acceptance (David's signed run)
1. Chat "send mommy $1 every Friday" → PolicyCard with correct sentence →
   confirm (incl. allowlist signing if needed) → appears in Standing orders.
2. Set a policy due NOW (schedule a 'once' or manipulate timeUTC near) →
   worker executes within a tick → activity "Autopilot sent…" → on-chain
   sender = agent, recipient = mommy.
3. Idempotency: restart worker immediately after a run → no double-send
   (policy_runs blocks); force a second worker instance briefly → same.
4. Insufficient funds path: empty Spend, policy fires → topup composition or
   clean failure card; no partial/ambiguous state.
5. Pause stops next run; Delete removes; sentence list accurate.
6. Amount guard: "send mom $5 weekly" can never create a $50 policy.
7. Unlisted recipient policy cannot activate without the allowlist signature;
   grep confirms no execution path bypasses agent_send.
8. Zero LLM in worker (grep, as Phase A).

## Prereqs (David)
None new — Railway on main auto-deploys the worker changes; agent gas topped
up as needed (sends burn slightly more than rebalances).
