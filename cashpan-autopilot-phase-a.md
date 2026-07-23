# CashPan — Autopilot Phase A (agent spine)

**Spec for Claude Code. Branch `feat/autopilot`. Do NOT merge without David's
signed end-to-end.** Goal: the smallest slice that proves the whole agent loop —
owner issues AgentCap → always-on worker executes deterministic buffer/band
rebalancing → owner kills it with one tap. No LLM in the execution path, no
sends, no schedules (Phase B). The Move layer is DEPLOYED and UNTOUCHED — this
phase is TS only.

## First principles (binding)
- LLM never signs, never triggers signing. Phase A has zero model involvement.
- Brain proposes / rules execute / chain enforces. The worker is a rules engine.
- Ask-me remains default. Autopilot is opt-in per vault, revocable instantly.
- Every autopilot action is attributed in activity and bounded by on-chain caps.

## A1. Agent identity
- One agent keypair for the service (ed25519). Secret in env `AGENT_SECRET_KEY`
  (worker env only — NEVER in the Next.js/Vercel app env). Derive + log the
  agent address at worker boot. KMS later; env now (note in CLAUDE.md).
- The agent pays its own gas (no Shinami for agent txns — sponsorship is for
  users). David funds the agent address with a few SUI; worker logs a LOW GAS
  warning under 0.5 SUI.

## A2. Enable/disable flow (app)
- Settings gains an Autopilot section: toggle + plain consequence copy:
  "CashPan will automatically move money between your Spend and Save pockets
  to match your rule (keep $X in Spend), up to $Y per day. You can turn this
  off anytime — it stops instantly."
- Enable → owner-signed PTB calling the existing `issue_agent_cap` for the
  agent address with caps: per_tx = max(buffer*2, $50), daily = $Y (user-
  visible input, default $100). Verify exact cap args against vault.move —
  do not guess the signature.
- Disable → owner-signed revoke (existing nonce mechanism). Confirm on-chain
  revoke semantics: bumped nonce invalidates outstanding cap immediately.
- Mongo Vault row gains `autopilot: { enabled, agentCapId, dailyCapBase,
  enabledAt }` — owner intent, not derived state, so storing is correct.
  Migration rule applies: default absent = disabled, no backfill needed
  (absence handled).

## A3. The worker (new deployable, `worker/`)
- Small standalone Node service (Railway or Fly, David's pick — spec assumes
  Railway). Own package.json; imports shared logic from the repo (monorepo
  path or duplicated minimal libs — prefer importing lib/ via workspace).
- Loop every 60s:
  1. Load autopilot-enabled vaults from Mongo.
  2. For each: read on-chain state (reuse the GraphQL read layer — same
     QuickNode env), compute policy: liquid vs buffer/band, EXACT same
     decision function the brain uses (`computeProposals` extracted to a
     shared pure module if not already) — one policy implementation, two
     callers.
  3. If action warranted: build `rebalance` PTB (existing builder), sign with
     agent key, submit. Respect on-chain caps by construction; also check
     locally and skip+log if a proposed amount would exceed remaining daily
     cap (avoid burning gas on guaranteed aborts).
  4. Idempotency: in-memory last-action map + minimum 5-min cooldown per
     vault per direction. Restart-safe enough for rebalancing (worst case:
     one extra evaluation, chain caps bound it). The durable idempotency
     LEDGER is Phase B (sends need it; rebalances don't).
- Failure handling: per-vault try/catch; an abort on one vault never stalls
  the loop; abort codes logged with vault id. Repeated aborts (3+) on a vault
  → mark `autopilot.suspended=true` + surface in app ("Autopilot paused —
  needs attention"), require owner re-enable. Never retry-loop into gas burn.
- Health: /healthz endpoint; LOW GAS + suspended-vault warnings in logs.

## A4. App surface
- Activity attribution: rebalance events signed by the agent address render as
  "Autopilot swept/topped up …" (attribution by tx sender — on-chain fact, not
  a stored label).
- Dashboard: small "Autopilot on" indicator near pockets when enabled;
  suspended state shows the pause notice with re-enable path.
- Proposal interplay: while autopilot is enabled, the app's own sweep/topup
  PROPOSALS for that vault are suppressed (the worker acts instead; two voices
  would race). Arrival/add proposals unchanged. Manual Move always available
  and takes precedence (worker cooldown prevents immediate counteraction).

## A5. Out of scope (Phase B/C — do not build)
Scheduled sends, allowlist management UX, conditional rules, policy schema,
durable idempotency ledger, LLM policy authoring, streaming (worker polls).

## Acceptance (David signs the end-to-end)
1. Enable Autopilot (owner-signed cap issuance) → indicator on.
2. Deposit so liquid > buffer+band → within ~2 min the WORKER (not a user
   signature) rebalances; activity shows "Autopilot swept $X"; on-chain sender
   = agent address.
3. Spend below buffer−band → worker tops up, same attribution.
4. Manual Move while enabled works; worker does not immediately counteract.
5. Disable → revoke lands → force a threshold cross → worker attempts nothing
   (or attempt aborts on-chain and is logged once, then suspended) — verify
   which, document actual revoke behavior.
6. Daily cap: set $5 cap, trigger > $5 of rebalancing need → worker stops at
   cap, logs, resumes next day (or on cap-window reset per vault.move rules —
   verify window semantics on-chain).
7. Kill the worker process mid-day → nothing breaks for users; ask-me flows
   unaffected; restart resumes cleanly.
8. Zero LLM calls anywhere in worker (grep).

## David's prerequisites
- Railway (or Fly) account under an Anansi email; project + env (MONGODB_URI,
  QuickNode vars, AGENT_SECRET_KEY, network).
- Fund agent address with ~2 SUI after first boot logs it.
