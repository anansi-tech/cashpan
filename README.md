# CashPan

An agent that autonomously keeps a liquid buffer in your wallet and sweeps the rest to savings — on your own Sui wallet, non-custodial, capped, revocable, zero taps.

---

## The idea in plain English

Picture your wallet with two compartments: a **spend pocket** and a **savings pocket**.

You tell the agent three numbers:

- **Buffer** — the floor you always want in the spend pocket. ("Never let my spending pocket drop below 0.25 SUI.")
- **Band** — a small cushion above the buffer so the agent doesn't fuss over tiny amounts. ("Don't bother unless it's clearly worth it.")
- **Per-tx cap** — the most it can move in a single transaction.

Every few minutes the agent checks:

| Condition | Action |
|-----------|--------|
| `liquid > buffer + band` | **Sweep** — move the excess into savings |
| `liquid < buffer` | **Top-up** — pull from savings back into liquid |
| Otherwise | **Noop** — leave it alone |

The everyday version: *"I keep $250 in checking. I've got $500. The extra $250 is way more than my wiggle-room, so move it to savings."* Next tick, with only the buffer left, the agent does nothing.

The band is the part people miss — without it, every few cents above the buffer would trigger a transaction. The band is what keeps the agent calm instead of twitchy.

In v1, the savings pocket earns yield. Funds swept to savings sit in a `YieldVenue` and accrue interest every epoch. A top-up returns principal plus whatever has accrued — so your spend pocket gets topped up with *more* than was originally swept.

---

## Non-custodial design

The agent never holds your money. It holds an `AgentCap` — a scoped capability that can **only** call `rebalance()`, bounded by two on-chain hard limits:

- **Per-tx cap** — maximum moved in a single transaction
- **Daily cap** — maximum moved per epoch (resets automatically)

The `AgentCap` has no path to an arbitrary withdrawal address. It can only shuffle funds between your vault's own liquid and savings pockets. If you ever want to revoke the agent, one owner transaction bumps a nonce and the existing cap is instantly dead.

You hold the `OwnerCap`. That's the only key that can deposit, withdraw, or issue/revoke agent caps.

---

## Architecture

```
┌─────────────────────────────────┐
│  Off-chain agent (TypeScript)   │
│                                 │
│  sense → decide → act           │
│  (no LLM on this path)          │
└────────────┬────────────────────┘
             │ PTB via Sui RPC
┌────────────▼────────────────────┐
│  On-chain (Move)                │
│                                 │
│  Vault<T>                       │
│  ├─ liquid: Balance<T>          │
│  └─ savings_position: Position  │
│       └─ backed by YieldVenue   │
│                                 │
│  OwnerCap  (full control)       │
│  AgentCap  (rebalance only)     │
└─────────────────────────────────┘
```

### On-chain modules (`move/sources/`)

**`vault.move`** — the trust core. A shared `Vault<T>` holds the liquid balance and a venue-backed savings position. All agent operations go through capability checks before touching any balance.

**`yield_venue.move`** — the yield boundary. A shared `YieldVenue<T>` holds deposited principal and an interest reserve. Accrual formula: `value = principal + principal × rate_bps × elapsed_epochs / (10_000 × period_epochs)`. The `// SWAP POINT` comment marks where to wire in a real protocol (Scallop, Navi, Sui Dollar) for mainnet.

### Off-chain (`src/`)

| File | Role |
|------|------|
| `sense.ts` | Reads vault + venue objects via RPC; computes `current_value` locally |
| `decide.ts` | Pure function — sweep / topup / noop. No I/O, no model imports |
| `act.ts` | Builds and submits a PTB calling `vault::rebalance` |
| `agent.ts` | `setInterval` loop — sense → decide → act, logs every tick |

`decide.ts` is the brain. It has no side effects and is unit-tested independently of any chain state.

---

## Quickstart

**Prerequisites:** Sui CLI configured for testnet, Node 20+.

```sh
# 1. Install dependencies
npm install

# 2. Get testnet SUI (you need ~5 SUI for setup)
#    https://faucet.sui.io

# 3. Deploy everything and write .env
npm run setup

# 4. Start the agent
npm run agent
```

`setup` publishes both Move modules, creates the `YieldVenue` (10%/epoch rate on testnet, pre-funded reserve), creates the `Vault` bound to it, issues an `AgentCap` to a fresh keypair, deposits initial liquid, and writes all object IDs + the agent private key to `.env`.

On the first tick, if `liquid > buffer + band`, the agent sweeps the excess into savings. You can watch it on the Sui testnet explorer links printed by setup.

---

## Configuration (`.env`)

| Variable | Description |
|----------|-------------|
| `PACKAGE_ID` | Published Move package |
| `VENUE_ID` | YieldVenue shared object |
| `VAULT_ID` | Vault shared object |
| `OWNER_CAP_ID` | Your OwnerCap (keep safe) |
| `AGENT_CAP_ID` | AgentCap held by the agent keypair |
| `AGENT_PRIVATE_KEY` | Agent's Bech32 private key |
| `BUFFER` | Target liquid floor (MIST) |
| `BAND` | Dead-band above buffer (MIST) |
| `INTERVAL_MS` | Tick interval (default 300000 = 5 min) |

---

## Development

```sh
# Move tests (run from move/)
sui move test

# TypeScript unit tests
npm test

# Single Move test by name
sui move test test_revoked_agent_cap_cannot_rebalance
```

---

## Roadmap

- **Now:** sense → decide → act loop, venue-backed yield, testnet
- **P1:** Swap `YieldVenue` for Scallop / Navi / Sui Dollar on mainnet
- **P2:** LLM intent layer — "keep $50 liquid, save the rest" → config
- **P3:** "money talks" chat — balances, earnings, agent narration
- **P4:** Fiat on-ramp + on-chain-native income (remittance, gig payouts)
