# CashPan — Post-Mainnet Cleanup & Fixes

**Spec for Claude Code.** Author: CTO. Real-yield Suilend integration is live and
verified (deposit→sweep→earn→topup→redeem all working on mainnet). This closes the
loose ends. **None of these require republishing the Move package** — all off-chain,
UI, or source-only. Do them all; each section is independent.

Package (live, unchanged): `0x0c712a7d09af1483ccf459506edd04c5460fec30e2087cbc1aa61f5c85c0d61d`
Venue: `0x3d77cae542c2f6a2df1e70be578a28af550c8fd49599aaff54fe5be16d54020c`

---

## 1. Expose `band` in settings UI (bug: unreachable setting)

The settings API (`app/api/settings/route.ts`), Mongo schema, defaults, and
`brain.computeProposals` all handle `band` — but the UI only renders `buffer`, so
`band` is stuck at the default `5` and unreachable. **Both are dollar amounts** (fed
through `humanToBase`, 6-decimal USDC):
- `buffer` = target USD to keep in **Spend** (liquid).
- `band` = hysteresis: agent only proposes a sweep when `liquid > buffer + band`,
  preventing churn on tiny amounts. At buffer=$0.20 / band=$5, auto-sweep won't fire
  until Spend exceeds $5.20 — which is why it must be user-settable.

Fix **both** `components/SettingsPanel.tsx` and `components/AccountMenu.tsx`:
1. Add `band` state mirroring `buffer` (`useState(settings.band)`, sync effect,
   include in `isDirty`).
2. Add a second numeric input. Suggested copy so the semantics are legible:
   - Row reads: **"Keep at least `[buffer]` in Spend · only move when Spend is over
     that by `[band]`"** — or two labeled rows. Keep it plain-language; "band" is
     jargon, don't surface the word.
3. POST both in the body: `JSON.stringify({ buffer, band })`. The route already
   accepts and validates both.
4. Same `min="0"`; `step="0.01"` (dollars, not integers — buffer/band can be cents).

**Acceptance:** user can set band from the UI; `/api/settings` persists it; reload
shows the saved value; `computeProposals` sweep threshold reflects it.

---

## 2. Real yield display (bug: `Yield ~0% / yr`) — rip mock scaffolding, wire live data

`lib/read-layer.ts` still returns mock fixed-rate fields — `rateBps:'0'`,
`periodEpochs:'1'`, `entryEpoch:'0'`, and `getEarnings` hardcodes
`{accrued:'0', aprBps:'0'}`. These are leftovers from the reserve-funded mock venue;
the Suilend cToken venue has no fixed rate. `LiveDashboard.tsx` computes a synthetic
`projectSavings(principal, rateBps, elapsedEpochs, periodEpochs)` off these zeros →
always 0%.

### 2a. Live APR from Suilend
Read the native-USDC reserve's **supply APR** live and surface it.
- Preferred: Suilend SDK exposes computed per-reserve deposit APR. Reuse the
  `SuiGrpcClient` + `@suilend/sdk/client` + `SuilendClient.initialize` pattern from
  `scripts/resolve-suilend.mjs`; read the parsed reserve at `RESERVE_INDEX` and its
  deposit/supply APR field. Confirm the exact field name against the parsed reserve
  (the probe dump showed `depositAprPercent`-style values live on the reserve).
- Fallback (if SDK APR not exposed): compute from reserve fields —
  `supplyAPR = borrowAPR × utilization × (1 − spreadFeeBps/10000)`, where
  `utilization = borrowedAmount / (borrowedAmount + availableAmount)` and `borrowAPR`
  interpolates the `interestRateUtils`/`interestRateAprs` curve. More code; only if
  needed.
- Cache it briefly (per request is fine; it moves slowly). Surface as a real percent
  through the state payload.

### 2b. Accrued earnings (cost-basis tracking)
`getBalances` currently sets `savingsPrincipal = savingsValue`, so accrued is always
0. In the cToken model, value = `ctoken_amount × ratio`; there's no on-chain principal.
Track **cost basis** in Mongo per vault:
- Add `savingsPrincipal` (base-units string, default `'0'`) to the Vault schema.
- Update it where RebalanceEvents are processed (the Block 3 watcher, `lib/watcher.ts`,
  already consumes these with a durable cursor — do it there, not client-side):
  - **SWEEP**: `savingsPrincipal += amount` (underlying deposited).
  - **TOPUP/redeem**: reduce proportionally — `savingsPrincipal -= floor(savingsPrincipal
    × withdrawnValue / valueBeforeWithdraw)`. This realizes a proportional slice of
    basis+gains, which is the correct model. Floor at 0.
- `getEarnings`: `accrued = max(0, savingsValue − savingsPrincipal)`;
  `aprBps` = the live Suilend supply APR from 2a.

### 2c. Rip the mock machinery
- Delete `rateBps`, `periodEpochs`, `entryEpoch` from `Balances` and everywhere they
  flow (`read-layer.ts`, `LiveDashboard.tsx`, `Dashboard.tsx`).
- Delete `projectSavings` and the epoch-based growth formula. Real growth = the
  Savings value (`current_value`, already live) rising. Drive any "growing" animation
  off periodic `current_value` re-reads (the live data layer already polls), not a
  synthetic rate.
- Display copy: show APR as **variable** — e.g. "~X% APR (variable)" — never a fixed
  promise. Suilend supply APR floats with borrow demand.

**Acceptance:** dashboard shows the live Suilend USDC supply APR (a few %, not 0);
after a sweep, accrued starts at ~0 and rises over time as the cToken ratio climbs;
no `rateBps`/`periodEpochs`/`projectSavings` references remain.

---

## 3. Centralize RPC — one client, kill idiom sprawl + testnet defaults

Today the app carries three idioms: `SuiJsonRpcClient` (in `auth`, `execute-zklogin`,
`read-layer`, `propose`, `watcher`, `suilend-sanity`), raw `suix_getCoins` fetch (in
`brain`, `state` route), and the probe's `SuiGrpcClient`. And two files still default
network to `'testnet'` (`auth.ts:37`, `execute-zklogin.ts:19`) — latent footguns that
only work because `NEXT_PUBLIC_SUI_NETWORK` happens to be set.

Note: `SuiJsonRpcClient.getCoins` was found to silently return `[]` at `@mysten/sui@2.15`
even when the fullnode has the coin (why `brain`/`state` use raw fetch). Its
`getObject`/`devInspect` work fine. Don't trust `SuiJsonRpcClient.getCoins`.

Create `lib/sui.ts` as the single RPC surface:
```ts
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet';
const RPC_URL = process.env.SUI_RPC_URL ?? getFullnodeUrl(NETWORK);

export function suiClient() {
  return new SuiClient({ url: RPC_URL });   // known-good for getObject/devInspect/sign at 2.15
}

// Version-proof coin read (SDK getCoins is unreliable at 2.15). Proven via curl.
export async function getCoinsRaw(owner: string, coinType: string) {
  const res = await fetch(RPC_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_getCoins',
      params: [owner, coinType, null, 50] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`suix_getCoins: ${json.error.message}`);
  return (json.result?.data ?? []).map((c: { coinObjectId: string; balance: string }) =>
    ({ coinObjectId: c.coinObjectId, balance: c.balance }));
}

export function suiNetwork() { return NETWORK; }
```
Then:
- Replace every `new SuiJsonRpcClient(...)` with `suiClient()`. Drop the
  `@mysten/sui/jsonRpc` imports.
- Replace the inline raw-fetch coin reads in `brain.ts` and `app/api/state/route.ts`
  with `getCoinsRaw(...)`.
- Default network `'mainnet'` everywhere (or throw if `NEXT_PUBLIC_SUI_NETWORK` unset —
  your call; mainnet default is fine now).
- `app/page.tsx:110` epoch badge: use `suiNetwork()` instead of `?? 'testnet'`.
- **Verify `suiClient().getObject` / `.devInspectTransactionBlock` still work** in
  `read-layer`/`propose`/`suilend-sanity` (they should — `SuiClient` is what
  `admin-signer.js` already uses). Keep `getCoinsRaw` as the only coin-read path.

**Acceptance:** one client factory imported everywhere; no `SuiJsonRpcClient` left; no
`'testnet'` default in any runtime path; app reads/signs/deposits unchanged; the $-flow
still works end to end.

---

## 4. Remove dead testnet code (clean-codebase hard bar)

All dead on mainnet. `vault_tests.move` does **not** reference `test_usd` (verified), so
deletion is safe.
- Delete `move/sources/test_usd.move`. Run `sui move test` — must stay green.
  (The live package still contains the module harmlessly; it drops out on the next
  publish. Do **not** republish just for this.)
- Delete `scripts/fund-vault.ts` (mints TEST_USD via treasury cap — impossible for
  native USDC).
- `scripts/deposit.ts`: defaults to testnet and uses the CLI keypair. The app's Receive
  flow replaces it. Delete it, or if you want a CLI deposit convenience, fix its default
  to mainnet and keep. Recommend delete — the product path works.
- Remove `TREASURY_CAP_ID` from `.env.example` and any reference in `scripts/setup.ts`
  (setup no longer creates it on mainnet).
- Grep for other `TEST_USD`/`TREASURY_CAP`/`test_usd` references and remove stragglers.

**Acceptance:** no `test_usd`/`TREASURY_CAP`/`fund-vault` references remain; `sui move
build` + `sui move test` green; `npm run setup` still works (it doesn't touch test_usd).

---

## 5. Add `network` field to Vault schema (prevent testnet/mainnet collision)

The Vault registry keys on `identityKey` (zkLogin sub) with **no network discriminator**
— which is exactly what caused the "Vault not found" 500 during cutover (a testnet vault
record resolved on mainnet). Prevent recurrence.
- Add `network: { type: String, required: true, default: 'mainnet' }` to `VaultSchema`
  in `lib/db/vault-registry.ts`.
- Change the unique index from `identityKey` alone to a **compound** unique index on
  `{ identityKey, network }`, so the same user can hold one vault per network without
  collision.
- `getActiveVault(identityKey)` → `getActiveVault(identityKey, network = current)`;
  filter by both. Thread the current network (from `suiNetwork()`) at call sites
  (`page.tsx`, `state`/`settings`/`vault-register` routes).
- `registerVault` / provisioning writes `network: suiNetwork()`.

**Acceptance:** vault lookups are network-scoped; a stale other-network record can't
resolve; provisioning stamps the network.

---

## Sequencing & notes
- **1, 4, 5** are quick and independent — do first.
- **3** (RPC centralization) touches many files; do it before/with **2** so the new APR
  read uses the centralized client.
- **2b** (accrued cost-basis) is the only piece with real accounting nuance — get the
  proportional withdrawal reduction right, or accrued drifts after topups.
- Nothing here republishes the contract. After all land: restart, re-run the $-flow once
  (sweep small → confirm APR shows non-zero + accrued ticks → topup → redeem) to confirm
  no regression.
