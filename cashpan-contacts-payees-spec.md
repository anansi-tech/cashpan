# CashPan — Contacts (Payee Management) Spec

**One line:** A per-user contacts list (nickname → Sui address) so a person can say "send mom $5" instead of pasting an address — stored **off-chain** (instant, no gas, no signing), with the real destination address always shown on the confirm card. Retires the `PAYEES` env var.

---

## Design note (revised from the earlier on-chain pin)

The earlier pin was on-chain payee labels — conceived when the allowlist was a security gate. **Block 4 changed that:** the user now signs unrestricted owner sends, so the on-chain allowlist is dormant, reserved for Autopilot. Therefore:
- **Contacts = off-chain address book** — convenience only, instant, free. Adding a contact must NOT cost a transaction.
- **On-chain allowlist = Autopilot guardrail** — returns later as "which contacts the agent may auto-pay" (a subset the user authorizes). Out of scope here.
- **Safety net:** the confirm card always shows the **actual destination address**, so a nickname can never hide where money goes. The user verifies the address and signs.

---

## Vocabulary (locked — use throughout new UI)

**Spend** and **Save** = the two pockets. **Pockets** = the casual collective. **CashPan** = the whole account. No "liquid," no "pocket" as a label, no bank jargon in user-facing strings. (Sweeping the *existing* screens for stray "liquid"/`liquidSui` is a polish-pass item; new contacts UI must use the locked vocabulary from the start.)

---

## Scope discipline

**In scope:** per-user contacts in Mongo (label, address, createdAt); a Contacts UI (add / list / remove); send-resolution from the address book (replacing `PAYEES` env); the confirm card showing the resolved real address; the vocabulary lock in new UI.

**Deferred:** on-chain allowlist management and per-contact agent-authorization (Autopilot); contact editing (remove + re-add is fine for v1); contact avatars/grouping.

---

## Decisions / assumptions

- **Off-chain, per-user, keyed by the zkLogin `sub`** — stored in the existing Mongo (a `payees` array on the user/vault record, or a small `payees` collection). No keys, just `{ label, address, createdAt }`.
- **Address validation on add:** must be a well-formed Sui address (`0x` + 64 hex). Reject malformed; trim whitespace.
- **Resolution:** case-insensitive label match. Unknown label → the proposal returns a graceful "not a saved contact" and offers either sending to a typed address (owner can send anywhere) or adding the contact. **Never guess an address.**
- **Term:** user-facing label = **"Contacts"** (friendlier and more universal than "Payees"). Override only if you prefer "Payees."
- **Confirm card always shows the real destination address** (truncated, full on tap), regardless of nickname.

---

## Components

### 1. Data + API
- Per-user payees keyed by session `sub`. Functions: `listPayees`, `addPayee(label, address)`, `removePayee(label|id)`.
- API routes auth-gated via the session (`resolveVault`/sub) — a user only ever sees/edits their own contacts.

### 2. Contacts UI
- A simple Contacts panel/screen: list of saved contacts (nickname + truncated address + copy), an **Add contact** form (nickname + address, validated inline), and remove. Instant — no transaction, no gas, no signing. Plain, warm, Spend/Save vocabulary.

### 3. Send resolution (replace `PAYEES` env)
- The propose layer resolves "send <name> $X" against the user's contacts instead of the `PAYEES` env. Found → proposal with label + resolved address. Not found → graceful path (type an address, or "add <name> as a contact?").

### 4. Confirm card
- Show the resolved **label and the actual destination address** (truncated, expandable). This is the safety check — the user confirms where the money goes, not just the nickname.

### 5. Retire `PAYEES`
- Remove the env var and all reads of it; resolution now reads the per-user store only.

---

## Acceptance criteria

1. A user can add a contact (nickname + validated Sui address), see their list, and remove one — all instant, **no on-chain transaction, no gas**.
2. Contacts are per-user (keyed by session `sub`); user A cannot see or use user B's contacts.
3. "send mom $5" resolves "mom" from the user's contacts → `owner_send`; the confirm card shows "mom" **and the actual address**.
4. An unknown name never resolves to a guessed address — the user is offered a typed-address send or an add-contact prompt.
5. `PAYEES` env var is retired; resolution reads the per-user store.
6. Sending to a raw typed address (not a saved contact) still works.
7. All new UI uses **Spend / Save / pockets / CashPan**; no "liquid" or bank jargon in user-facing strings.
8. The confirm card always shows the real destination address regardless of the nickname.

---

## Build order

1. Payee data model + auth-gated API (per-user).
2. Contacts UI (add / list / remove, inline address validation).
3. Swap send-resolution from `PAYEES` env → per-user store; retire the env var.
4. Confirm card shows label + real address.
5. Use the locked vocabulary in all new UI.

---

## After this

- **Polish pass** — empty/loading/error/pending states, receive screen, onboarding clarity, the existing-screen vocabulary sweep (`liquidSui` rename, plain-English error copy), and the cleanup debts (phantom setup vault, duplicated decimals, dead env vars).
- **Block 3** — propose-on-deposit brain.
- **Real yield** — Suilend on testnet → mainnet.
- **Autopilot** — the on-chain allowlist returns as per-contact agent-authorization.
