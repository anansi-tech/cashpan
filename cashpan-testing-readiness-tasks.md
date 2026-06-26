# CashPan — Testing-Readiness Tasks (for Claude Code)

Goal: make the app testable end-to-end with **zero code work left for the operator** — they only fill in secret env values and click through the test. Four small tasks.

---

## Task 1 — `test_usd::mint_coin` (Move, ~3 lines)

`test_usd::mint` currently uses `coin::mint_and_transfer` (sends to a recipient, returns nothing), so it can't compose with `vault::deposit` in one transaction. Add a sibling that **returns** the coin:

```move
public fun mint_coin(
    cap: &mut coin::TreasuryCap<TEST_USD>,
    amount: u64,
    ctx: &mut TxContext,
): coin::Coin<TEST_USD> {
    coin::mint(cap, amount, ctx)
}
```

Keep the existing `mint` for back-compat. Rebuild; existing tests stay green.

---

## Task 2 — `scripts/fund-vault.ts` (mint + deposit into any vault by ID)

A script to fund a per-user (Google-provisioned) vault on testnet, since `deposit.ts` only targets the single env `VAULT_ID`. Mints test USD via the `TreasuryCap` from `setup`, deposits into the given vault via the permissionless `vault::deposit`.

```
tsx scripts/fund-vault.ts --vault 0xVAULT --amount 100
```

- Read `PACKAGE_ID`, `COIN_TYPE`, `TREASURY_CAP_ID`, `SUI_RPC_URL` from env; convert `--amount` via the shared `toBase` (COIN_DECIMALS).
- One PTB: `mint_coin(cap, amount)` → `vault::deposit(vault, coin)` (type arg = `COIN_TYPE`).
- Sign with the owner keypair (reuse `script-helpers`), print the digest.
- Add `"fund-vault": "tsx scripts/fund-vault.ts"` to `package.json` scripts.

---

## Task 3 — Update `.env.example` to the real, current variable set

It's stale. Replace with everything the app actually reads, grouped, with comments:

```
# ─── Chain / deploy (from `npm run setup`) ───
SUI_RPC_URL=https://fullnode.testnet.sui.io:443
NEXT_PUBLIC_SUI_NETWORK=testnet
PACKAGE_ID=0x
VENUE_ID=0x
TREASURY_CAP_ID=0x
COIN_TYPE=0x<PKG>::test_usd::TEST_USD
COIN_DECIMALS=6
COIN_SYMBOL=USD
NEXT_PUBLIC_COIN_TYPE=0x<PKG>::test_usd::TEST_USD
NEXT_PUBLIC_COIN_DECIMALS=6
NEXT_PUBLIC_COIN_SYMBOL=USD

# ─── Auth / zkLogin / gas (reuse Spice creds) ───
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
NEXT_PUBLIC_REDIRECT_URL=http://localhost:3000/auth/callback
SHINAMI_GAS_STATION_KEY=
SHINAMI_ZKLOGIN_KEY=

# ─── App ───
MONGODB_URI=
OPENAI_API_KEY=sk-...
PAYEES={"mom":"0xRECIPIENT"}

# ─── Legacy / dev-only (standalone agent loop + single-vault scripts; NOT used by the web app) ───
# VAULT_ID=0x
# AGENT_PRIVATE_KEY=
# AGENT_CAP_ID=
# BUFFER=50
# BAND=5
# INTERVAL_MS=60000
```

The legacy block is commented out on purpose — the multi-user web app does not read those; only `src/agent.ts` and the old single-vault scripts do.

---

## Task 4 — Surface the vault ID on the dashboard (small UX)

`app/page.tsx` already loads `vault.vaultId` and `vault.payoutAddress`. Add a small, unobtrusive account line near the top showing the **vault ID** (truncated) and the user's **address**, each with a copy-to-clipboard button. This is what the operator needs for `fund-vault.ts`, and it's the seed of the future "receive" screen. Keep it minimal — one line, two copy buttons.

---

## Acceptance

1. `test_usd::mint_coin` returns a `Coin<TEST_USD>`; `sui move test` green.
2. `npm run fund-vault -- --vault 0x.. --amount 100` mints + deposits into that vault in one tx and prints a digest; the vault's liquid balance increases by the amount.
3. `.env.example` lists every variable the app reads, with the legacy ones clearly marked and commented out.
4. The dashboard shows the signed-in user's vault ID and address with copy buttons.
5. No web-app code reads `VAULT_ID` / `AGENT_PRIVATE_KEY` / `AGENT_CAP_ID` (already true — keep it true).

---

## After Claude Code finishes, the operator does ONLY this

1. Fill secrets in `.env` (Google client ID, Shinami keys, Mongo URI, OpenAI key — reuse Spice creds), and in Google Cloud add `http://localhost:3000/auth/callback` as a redirect URI; fund the Shinami testnet gas station.
2. `npm run setup` → copy `PACKAGE_ID`, `VENUE_ID`, `TREASURY_CAP_ID`, and the `test_usd` type into `.env`.
3. `npm run dev` → sign in with Google → vault auto-provisions → copy your vault ID from the dashboard.
4. `npm run fund-vault -- --vault <your-vault-id> --amount 100`.
5. In chat: "put aside $10", "send mom $5", "give me back $5", "move $5 to spending" → confirm each → user-signed, gas-sponsored, digest. Sign in with a second Google account to confirm isolation.
