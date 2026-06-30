# CashPan

A non-custodial personal finance web app on Sui. Users sign in with Google (zkLogin), get their own on-chain vault, and manage money through a plain-language chat interface — no wallet extension required.

---

## What it does

Each user gets a **Vault** with two pockets:

- **Spend** — liquid balance, ready to use immediately
- **Save** — earns yield via `YieldVenue`, growing each epoch

The chat agent ("Money Talks") understands natural commands: *"send mom $10"*, *"put $50 in Save"*, *"what's my balance?"*. Every action is a user-signed transaction — the server never holds keys or moves funds autonomously.

An optional off-chain rebalance agent can run alongside to automatically sweep excess Spend into Save and top up Spend when it runs low. It holds only a scoped `AgentCap` — capped per-tx and per-epoch, no path to arbitrary withdrawal.

---

## Architecture

```
Browser (Next.js 15)
 ├── zkLogin sign-in (Google OAuth → Shinami ZK proof → Sui address)
 ├── LiveDashboard — polls /api/balances, animates savings via RAF
 ├── ChatPanel — useChat → /api/chat → streamText (GPT-4o-mini)
 │    └── ConfirmCard — user signs & Shinami sponsors each tx
 ├── ReceivePanel — shows address + QR; deposits owned coins into Spend
 └── ContactsPanel — per-user send book stored in MongoDB

Server (Next.js App Router, Node.js)
 ├── /api/chat        — AI SDK streamText, propose tools, contact resolution
 ├── /api/balances    — reads Vault + YieldVenue objects via Sui RPC
 ├── /api/activity    — reads RebalanceEvent history
 ├── /api/contacts    — CRUD contacts in MongoDB
 └── /api/provision   — creates a Vault for a new user at first sign-in

On-chain (Sui Move — move/sources/)
 ├── vault.move       — Vault<T>: liquid + savings_position, OwnerCap, AgentCap
 ├── yield_venue.move — YieldVenue<T>: fixed-rate stub; SWAP POINT for mainnet
 └── test_usd.move    — fungible token for testnet

Off-chain agent (src/ — standalone, optional)
 └── sense → decide → act loop; holds AgentCap; auto-rebalances
```

---

## Quickstart

**Prerequisites:** Sui CLI configured for testnet, Node 20+, MongoDB instance, Google OAuth credentials, Shinami account.

```sh
# 1. Install dependencies
npm install

# 2. Get testnet SUI (~2 SUI for setup)
#    https://faucet.sui.io

# 3. Copy and fill in .env
cp .env.example .env
# Fill in: NEXT_PUBLIC_GOOGLE_CLIENT_ID, SHINAMI_GAS_STATION_KEY,
#          SHINAMI_ZKLOGIN_KEY, MONGODB_URI, OPENAI_API_KEY

# 4. Deploy Move package + YieldVenue + test_usd, mint test tokens
npm run setup
# setup writes PACKAGE_ID, VENUE_ID, TREASURY_CAP_ID,
# COIN_TYPE, COIN_DECIMALS, COIN_SYMBOL to .env

# 5. Start the web app
npm run dev
```

Sign in with Google → vault is provisioned on first sign-in → use the Receive tab to add money.

---

## .env reference

| Variable | Set by | Description |
|----------|--------|-------------|
| `SUI_RPC_URL` | setup default | Sui fullnode RPC |
| `NEXT_PUBLIC_SUI_NETWORK` | setup default | `testnet` or `mainnet` |
| `PACKAGE_ID` | `npm run setup` | Published Move package |
| `VENUE_ID` | `npm run setup` | YieldVenue shared object |
| `TREASURY_CAP_ID` | `npm run setup` | test_usd TreasuryCap (testnet only) |
| `COIN_TYPE` | `npm run setup` | Full coin type string |
| `COIN_DECIMALS` | `npm run setup` | Decimal places (6 for test_usd) |
| `COIN_SYMBOL` | `npm run setup` | Display symbol (USD) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | manual | Google OAuth client ID |
| `NEXT_PUBLIC_REDIRECT_URL` | manual | OAuth callback URL |
| `SHINAMI_GAS_STATION_KEY` | manual | Shinami gas sponsorship |
| `SHINAMI_ZKLOGIN_KEY` | manual | Shinami ZK prover |
| `MONGODB_URI` | manual | MongoDB connection string |
| `OPENAI_API_KEY` | manual | Chat model (gpt-4o-mini) |

`NEXT_PUBLIC_COIN_TYPE/DECIMALS/SYMBOL` are **not** set in `.env` — they are derived from `COIN_TYPE/DECIMALS/SYMBOL` at build time via `next.config.ts`.

---

## Switching stablecoins

Set `COIN_TYPE`, `COIN_DECIMALS`, `COIN_SYMBOL` in `.env` — no code changes needed. The `NEXT_PUBLIC_*` variants derive automatically.

| Coin | `COIN_TYPE` | `COIN_DECIMALS` | `COIN_SYMBOL` |
|------|-------------|-----------------|---------------|
| test_usd (default) | `<pkg>::test_usd::TEST_USD` | `6` | `USD` |
| USDC | `0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN` | `6` | `USDC` |

---

## Development

```sh
# Web app
npm run dev          # Next.js dev server

# Move (run from move/)
sui move build
sui move test        # 40 tests: 17 vault + 9 yield_venue + 14 test_usd

# TypeScript unit tests
npm test             # decide.test.ts — 13 tests

# Optional standalone agent (legacy; uses VAULT_ID / AGENT_PRIVATE_KEY etc.)
npm run agent
```

---

## Non-custodial design

The server holds only a Shinami gas key (sponsors transactions, cannot sign them). Every fund movement is signed by the user's zkLogin key in the browser. The optional `AgentCap` is scoped to `rebalance()` — it cannot withdraw to any address outside the vault, and is bounded by per-tx and per-epoch caps set at vault creation.
