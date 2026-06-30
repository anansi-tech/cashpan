# CashPan — Live Data Layer + Per-User Buffer (centralize, don't scatter)

**One line:** Collapse the six scattered component fetches and two competing poll loops into **one client source of truth** for all vault data — with a **single `refresh()`** (called after every action) and **one poll loop** — so the UI is always live and never stale. And move the Spend buffer from a global env var to a **per-user setting**.

**Guiding principle (the real ask):** clean, minimal, robust, a joy to read. After this, a developer opening the project sees **one obvious place** where vault data lives and updates. Need vault data in a new screen? Call the hook. Changed state with an action? Call `refresh()`. No per-component fetches, no duplicate polls, no hunting. **This is a consolidation — net lines should go down.**

---

## The bugs this fixes (both are symptoms of the scatter)

1. **Stale-after-action** (the "$11 still available" banner after a successful Add): nothing re-pulls the wallet/proposal reads after an execute. One central `refresh()` called on every success fixes it everywhere at once.
2. **Not live to the world:** balances only update via `LiveDashboard`'s private 5s poll; proposals/wallet never poll. One central poll keeps the whole dashboard fresh when money arrives from others or the watcher.
3. **Global buffer:** `brain.ts` and `read-layer.ts` read `process.env.BUFFER`/`BAND` — one value for all users, unsettable by the user. Move to per-user.

---

## Current scatter to collapse (delete as you centralize)

- `LiveDashboard.tsx` — `fetch('/api/balances')` + private 5s `setInterval`.
- `ActivityFeed.tsx` — `fetch('/api/activity')` + private 30s `setInterval`.
- `ReceivePanel.tsx` — independent `checkWallet` fetch.
- `ProposalBanner.tsx` — independent `/api/proposals` fetch.
- `ContactsPanel.tsx` — independent `/api/contacts` fetch + mutations.
- `AsidePanel.tsx` — independent fetch.

All of these stop fetching directly and consume the central source instead.

---

## Design — one source of truth

### Client: a single `VaultDataProvider` + `useVaultData()` hook
- Owns all vault-derived reads: `balances`, `walletFunds`, `proposals`, `activity`, `earnings`, `settings` (incl. the user's buffer/band), plus `isLoading`.
- Exposes exactly: `{ ...data, isLoading, refresh }`.
- Internally: fetch on mount, **one** poll `setInterval` (a single interval — pick one cadence, e.g. 5s; activity can be derived from the same tick), and a `refresh()` that re-pulls.
- Components call `useVaultData()` and render. **They do not fetch vault data themselves.** Contacts mutations call their endpoint then `refresh()`.
- Use plain React context + a hook. **Do not** add a state library (Redux/Zustand) — keep dependencies minimal.

### The single `refresh()` after every action
`ConfirmCard` / `ProposalBanner` / `ReceivePanel` Add / Contacts add-remove → on **success**, call `refresh()`. The pending→success state you already built simply ends with `refresh()`. One call site pattern, everywhere.

### Server: one consolidated read
Prefer a single endpoint (e.g. `/api/state`) that returns the whole shape `{ balances, walletFunds, proposals, activity, earnings, settings }` in one round trip, so the client does one fetch per tick instead of five. Keep `read-layer.ts` as the single server module that computes vault-derived state; the brain/proposal logic reads from it (no duplicated read logic).

### Per-user buffer/band
- Store `buffer` and `band` on the **user's registry record** (Mongo), with sane **defaults** so the brain works before the user sets anything.
- A small **Settings** control ("Keep at least $__ in Spend") updates it instantly (no transaction) → then `refresh()`.
- `decide()` already takes buffer/band as params — feed it the **per-user** value. `brain.ts` and `read-layer.ts` stop reading `process.env.BUFFER`/`BAND`.
- Remove `BUFFER`/`BAND` from the web/brain env path.

---

## Acceptance criteria

1. Exactly **one** client source (`VaultDataProvider` + `useVaultData`) owns balances, walletFunds, proposals, activity, earnings, settings; **no component fetches vault data directly** (grep components for `fetch('/api/...` → only the provider and pure mutations remain).
2. **One** poll loop total (one `setInterval`); the separate `LiveDashboard` and `ActivityFeed` intervals are gone.
3. After any successful execute (Add / sweep / send / withdraw / contact change), the UI reflects new state via the single `refresh()` **without a manual browser refresh** — the stale-banner bug is gone.
4. Buffer/band are **per-user** (registry) with a default; a Settings control sets them instantly; the sweep proposal uses the user's value; `decide()` is fed the per-user value.
5. `BUFFER`/`BAND` removed from the web/brain env path (no `process.env.BUFFER`/`BAND` in `brain.ts`/`read-layer.ts`).
6. **Net lines decrease**; no duplicated fetch/poll/refresh logic remains; a new screen needs only `useVaultData()`.

---

## Build order

1. Server: consolidate into one `/api/state` returning the full shape (reuse `read-layer.ts`; no duplicated reads).
2. Client: `VaultDataProvider` + `useVaultData` (one fetch, one poll, one `refresh`).
3. Migrate the six components to consume it; delete their fetches and the two private intervals.
4. Wire `refresh()` into every execute-success and contact mutation.
5. Per-user buffer/band: registry field + default + Settings control; feed `decide()`; remove env buffer.
6. Verify: Add money → banner clears instantly (no refresh); external deposit → dashboard updates within one tick; set buffer in Settings → sweep proposal uses it.

---

## Out of scope (keep it simple)

Websocket realtime (polling is enough), push notifications, on-chain buffer storage (registry is simpler — revisit only if a reason appears). Don't add abstractions beyond the single provider; if it isn't shared, it doesn't belong in the central source.
