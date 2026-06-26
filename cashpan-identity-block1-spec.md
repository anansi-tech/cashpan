# CashPan — Identity Epic, Block 1: Multi-User Foundation

**One line:** Turn single-vault CashPan into a multi-user system — a permissionless (keyless) `deposit`, a Mongo registry mapping identity → vault, and a read/write path scoped to "the current user's vault" through one auth seam — **without zkLogin yet**, so the data model is proven before the auth complexity lands.

This is where CashPan grows a backend. Single-user was stateless (the chain was the database). "Which human owns which vault" is off-chain identity that has to live somewhere — that's the definition of going multi-user, not scope creep.

---

## The design hinge: one auth seam

Every request that touches a vault resolves the active vault through a **single function** — `resolveVault(req) -> { vaultId, ownerCapId, agentCapId, payoutAddress }`.
- **Block 1:** it reads a **dev selector** (query param / cookie / header) to pick which registered user→vault is active. No real auth.
- **Block 2:** zkLogin swaps in *behind this one function* — session → identity → vault. Nothing else in the app changes.

If adding zkLogin later requires touching anything beyond this seam, Block 1 was built wrong.

---

## Scope discipline

**In scope:** permissionless `deposit` + `DepositEvent`; Mongo registry (identity → vault, extensible for cursor + payees); the `resolveVault` seam (dev selector); vault-scoping the read layer, API routes, chat tools, propose, and execute; a `create-vault` script to make + register test vaults.

**Deferred (later blocks):**
- **Block 2** — zkLogin auth (swaps the dev seam); sign-in creates + registers the user's vault; the **cap-custody model** (user holds `OwnerCap` via zkLogin; in Ask-me the server holds no signing key).
- **Block 3** — event-driven brain: listen for `DepositEvent` across registered vaults with a **durable cursor (stored in the registry)** + a read-time fallback.
- **Block 4** — Ask-me action loop: proposal → notify → the **user's** zkLogin key signs client-side (reuse the Spice `auth` + `/api/sponsor` gas-sponsorship pattern) → submit. The signing model shifts from server/test key to user-signed **here**.

**Not changed in Block 1:** the signing model. Reads and writes get vault-scoped, but execute still signs with the existing test agent key. The server-signs → user-signs shift is Block 4. **Do not add new server-signing authority in this block.**

---

## Decisions / assumptions

- **DB: MongoDB (Atlas + Mongoose)** — reuse the CogniCare connection pattern and `MONGODB_URI`. The DB holds **only off-chain identity → vault mapping** (and, later, cursors + payees). **Never private keys.**
- **`deposit` becomes permissionless:** `deposit<T>(vault: &mut Vault<T>, coin: Coin<T>)` — no `OwnerCap`. Adding funds to a vault is always safe; this is the keyless-receive primitive. Emits `DepositEvent` (the event Block 3 listens for).
- **Registry fields per vault:** `identityKey` (dev placeholder now → zkLogin `sub` later), `vaultId`, `ownerCapId`, `agentCapId`, `payoutAddress`, `coinType`, `createdAt`. Reserve room for `eventCursor` (Block 3) and `payees` (later). **Global config** keeps `packageId`, `venueId`, `coinType`, rate — these are shared across all vaults (one deployment, one shared venue; each vault holds its own `Position`).
- **Test cap custody:** the `create-vault` script issues `OwnerCap` + `AgentCap` to your controlled test address (so the existing single agent key can sign for test vaults). The real per-user cap model is Block 2. Don't bake a custody decision here.

---

## Components

### 1. Move — permissionless deposit + event
- `deposit<T>(vault, coin)` — drop the `OwnerCap` arg; anyone can deposit. Joins into `liquid`.
- Emit `DepositEvent { vault_id, amount, liquid_after }`.
- Everything else (withdraw, send, rebalance, caps, allowlist, revoke) unchanged — deposit only **adds** to liquid, so no guard is weakened.

### 2. DB + registry
- Mongo connection (reuse the CogniCare pattern).
- A `Vault`/`User` model + functions: `registerVault(...)`, `getByIdentity(identityKey)`, `listVaults()` (Block 3 iterates this), `getActiveVault(...)`.

### 3. The `resolveVault(req)` seam
- Block 1: reads a dev selector (e.g. `?user=maria` or a cookie) → registry lookup → active vault. Single function, single responsibility.

### 4. Vault-scoped read + write
- Read layer, API routes, and chat read tools take a `vaultId` from `resolveVault` — **no single-env `VAULT_ID` reads left in the request path.**
- Propose + execute also operate on the resolved vault; **signing unchanged** (existing test agent key + the vault's `AgentCap` id). For test vaults, issue all `AgentCap`s to the same test agent address so one key signs.

### 5. `create-vault` script
- Create a vault (+ its caps to the test address) and `registerVault` it under a dev `identityKey`. Run twice → two registered vaults to test with.

---

## Acceptance criteria

1. `deposit` is permissionless (no `OwnerCap`) and emits `DepositEvent`; a deposit from a **non-owner** address succeeds and shows in that vault's balance/feed. Withdraw/send/rebalance guards unchanged (tests green).
2. A Mongo registry maps `identityKey → { vaultId, ownerCapId, agentCapId, payoutAddress, coinType }`, with room reserved for cursor + payees.
3. A single `resolveVault(req)` seam resolves the active vault; swapping to zkLogin later touches only this function (verify: dev selector is the only auth mechanism, isolated in one place).
4. Read layer, API, chat tools, propose, and execute are vault-scoped via the seam — no single-env `VAULT_ID` in the request path.
5. Two vaults created via `create-vault` can be viewed independently in the UI by switching the dev selector — each shows its own balances, feed, and chat answers.
6. No new server-signing authority added; execute still uses the existing test agent key; the DB stores no private keys.
7. Permissionless deposit only adds to liquid; outflow guards untouched.

---

## Build order

1. Move: permissionless `deposit` + `DepositEvent`; update `deposit.ts`; tests (non-owner deposit succeeds, event emitted, guards intact).
2. Mongo connection + registry model/functions.
3. `create-vault` script (create + register to a dev identity).
4. `resolveVault` seam (dev selector).
5. Refactor read layer + API + chat tools + propose + execute to vault-scoped via the seam.
6. UI dev user-switcher; verify two vaults independently.

---

## Security note

Permissionless deposit is safe — it's inflow only, no withdrawal path. The non-custodial property is preserved because **Block 1 adds no new server-signing authority**: the existing test agent key stays exactly as scoped, and the server-signs → user-signs shift lands in Block 4. The database holds only off-chain identity → vault mapping (and later cursors) — never keys.
