# CashPan — Identity Epic, Block 2: zkLogin Auth + User-Owned Vaults

**One line:** A user signs in with Google → gets a zkLogin Sui address → their own vault is created (which **they** sign for, gas sponsored, `OwnerCap` minted straight to their address) → it's registered → they see it. The auth seam swaps from the dev selector to the zkLogin session. **The server never holds a key that can move user funds.**

This is "the big one," but the hard parts are a port from Spice, not a fresh build.

---

## The cap-custody model (locked)

- The **user holds `OwnerCap`** at their zkLogin address and signs every money move with full owner authority — it's their own money.
- The **server holds no key that moves user funds.** It holds only a **gas-sponsor key** (Shinami), which can pay gas but cannot authorize transaction content. Non-custodial by construction.
- **`AgentCap` is not issued** in this block. It's the seed for *Autopilot* (opt-in, later), where a scoped agent key gets authorized for hands-off action. Until then, the caps/allowlist are dormant — correct, because you don't cap a person spending their own money.

---

## Reuse Spice (the payoff)

Port these from the Spice project rather than rebuilding:
- **zkLogin auth** — ephemeral keypair + nonce → Google OAuth → JWT → salt → `computeZkLoginAddress` → ZK proof → session (ephemeral key, zkProof, maxEpoch, salt, address, sub, aud).
- **Gas sponsorship** — the `/api/sponsor` route (Shinami) + the `executeTransaction` helper that builds tx bytes (`onlyTransactionKind`), requests sponsorship, signs with the ephemeral key, assembles `getZkLoginSignature`, and submits with **both** signatures (user zkLogin + sponsor).
- **Version-corrected from the start:** imports from `@mysten/sui/zklogin` (not the deprecated `@mysten/zklogin`); `getSecretKey()` not `.export()`; `genAddressSeed` from `sub + salt + aud`.

---

## Scope discipline

**In scope:** zkLogin sign-in → session; gas sponsorship + the dual-signature sign/execute helper; **user-signed, sponsored vault provisioning** on first sign-in (`OwnerCap` minted to the user's address); registry keyed by zkLogin `sub`; per-user **salt persistence**; the seam swap (dev selector → session) + auth-gating; reads driven by the authenticated user's vault.

**Deferred:**
- **Block 3** — event-driven brain (deposit detection + durable cursor + proposals).
- **Block 4** — user-signed **money moves**: an `owner_rebalance` Move fn (owner-callable sweep/topup, unrestricted), and wiring propose → confirm → **user-signed** execute (send / withdraw / sweep) using this block's signing machinery; retire the server-agent-key execute path for real users.

**In this block, the signing machinery is proven by vault creation only.** Moving money via chat stays on the existing path for your own testing and is rebuilt user-signed in Block 4.

---

## Decisions / assumptions

- **OIDC provider:** Google (as Spice). Add others later.
- **Salt persistence (critical):** the same user must get the **same** salt every login, or their address changes and they lose their vault. Persist a per-user salt keyed by `sub` (Mongo) at first sign-in; reuse on every subsequent login. Honest tradeoff: server-stored salt means server + a compromised Google account could derive the address — acceptable for now; note **Enoki** (Mysten's managed zkLogin: salt + proving) as the production hardening path.
- **Provisioning is user-signed.** First sign-in with no registry record → the **client** builds `create_vault`, gets it sponsored, the **user** signs via zkLogin, `OwnerCap` is minted directly to the user's address; the app reads the new IDs from tx effects and registers them. The server signs nothing for the user; it never touches the `OwnerCap`.
- **Registry record (Block 1 schema, now real):** `identityKey = zkLogin sub`, `vaultId`, `ownerCapId`, `payoutAddress = user's zkLogin address`, `coinType`, `salt`, `createdAt`. No `agentCapId` yet (deferred). No keys.

---

## Components

### 1. zkLogin auth + session (port Spice)
Sign in with Google → session as above. Auth-gate the app: no session → sign-in screen.

### 2. Gas sponsorship + sign/execute helper (port Spice)
`/api/sponsor` (Shinami, server-side key) + the client `executeTransaction(tx)` that sponsors, signs with the user's zkLogin session, and submits dual-signed. This is the **only** way the app signs — and it signs with the **user's** key, client-side.

### 3. User-signed vault provisioning
On first sign-in (no record for `sub`): client builds `create_vault` → `executeTransaction` (sponsored, user-signed) → `OwnerCap` to the user → register `{sub → IDs, salt, payoutAddress}` in Mongo. Idempotent: existing record → skip, load the vault.

### 4. Seam swap + auth gate
`resolveVault(req)` now reads the **zkLogin session's `sub`** → registry, replacing the dev `?user=` selector. This is the single point that changes from Block 1. Remove the dev selector from the request path (keep it behind an env flag for local testing if useful).

### 5. Reads driven by session
Dashboard + read chat tools now scope to the authenticated user's vault via the swapped seam — each signed-in user sees only their own vault.

---

## Acceptance criteria

1. Google sign-in produces a zkLogin session (address, sub, salt, proof, ephemeral key); no session → app is gated to the sign-in screen.
2. First sign-in provisions a vault **the user signs for** (sponsored); `OwnerCap` is owned by the user's zkLogin address; the server never holds it.
3. Per-user salt is persisted keyed by `sub` and reused on re-login → the **same address** every time (verify: sign out, sign in, same vault).
4. Registry record is keyed by `sub`, stores no private keys; `payoutAddress` = the user's zkLogin address.
5. `resolveVault` reads the session `sub` — the **only** changed auth point vs Block 1; dev selector removed from the request path.
6. Two different Google accounts get two different vaults; each sees only its own dashboard/feed/chat.
7. The server holds **no key that moves user funds** — grep `app/`/`lib/`: the only server key is the Shinami sponsor (gas only); no user `OwnerCap`/`AgentCap` signing server-side.
8. Gas is sponsored — the user never needs SUI and never sees a gas prompt (provisioning tx is sponsored).

---

## Build order

1. Port zkLogin auth + session (version-corrected) from Spice; auth-gate the app.
2. Port `/api/sponsor` + `executeTransaction` (Shinami); fund the testnet gas station.
3. Salt persistence in Mongo (keyed by `sub`); confirm stable address across logins.
4. User-signed sponsored `create_vault` provisioning + registry write; idempotent on re-login.
5. Swap `resolveVault` to the session; remove the dev selector from the request path.
6. Verify two Google accounts → two independent, self-owned vaults.

---

## Security note

The non-custodial line, made real: in Block 2 the server gains exactly one key — the **Shinami gas sponsor**, which can pay fees but cannot authorize transaction content (the user's zkLogin signature authorizes content). The server never holds the user's `OwnerCap` or any cap that moves their funds. Provisioning and gas are server-*facilitated*; ownership and signing authority are the **user's**. The one honest exposure is server-stored salt (server + compromised Google account → address derivation) — acceptable now, hardened later with Enoki.

---

## After this

- **Block 3** — event-driven brain: listen for `DepositEvent` across registered vaults with a durable cursor (in the registry) + read-time fallback; compute proposals per user.
- **Block 4** — user-signed money moves: `owner_rebalance` + propose → confirm → user-signed execute, on this block's signing machinery; retire the server-agent execute path.
- Then payee management (on-chain labels), real yield (Suilend), Autopilot (opt-in `AgentCap`).
