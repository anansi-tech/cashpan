/// Cashpan Vault — non-custodial liquidity buffer agent.
///
/// Owner keeps OwnerCap (full control). Agent holds AgentCap (scoped: rebalance only,
/// capped per-tx and daily, revocable by owner at any time via nonce bump).
///
/// v1: savings pocket is venue-backed — sweep deposits to YieldVenue, topup withdraws
/// principal + accrued interest. The venue boundary is in cashpan::yield_venue.
module cashpan::vault;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::clock::Clock;
use sui::event;
use std::option::{Self, Option};
use sui::vec_set::{Self, VecSet};
use cashpan::yield_venue::{Self, YieldVenue, Position};
use suilend::lending_market::LendingMarket;

// ============ Direction constants ============

const SWEEP: u8 = 0; // liquid → venue (savings)
const TOPUP: u8 = 1; // venue (savings) → liquid

// ============ Error codes ============

const EAgentRevoked: u64 = 0;
const EExceedsPerTxCap: u64 = 1;
const EDailyCapExceeded: u64 = 2;
const EInsufficientLiquid: u64 = 3;
const ENoSavingsPosition: u64 = 4;
const EInvalidDirection: u64 = 5;
const ENotOwner: u64 = 6;
const EWrongVenue: u64 = 7;
const ENotAllowlisted: u64 = 8;
const EOutflowExceedsPerTxCap: u64 = 9;
const EOutflowDailyCapExceeded: u64 = 10;

// ============ Objects ============

/// Shared object. `liquid` is the spendable pocket; `savings_position` is the
/// venue-backed yield position. Access governed by OwnerCap / AgentCap.
public struct Vault<phantom T> has key {
    id: UID,
    liquid: Balance<T>,
    /// Venue-backed savings. None until the first sweep; destroyed after full withdrawal.
    savings_position: Option<Position>,
    /// ID of the YieldVenue this vault is bound to.
    venue_id: ID,
    per_tx_cap: u64,
    daily_cap: u64,
    daily_spent: u64,
    last_reset_epoch: u64,
    agent_nonce: u64,
    // v2: outflow tracking
    payout_address: address,
    allowlist: VecSet<address>,
    outflow_per_tx_cap: u64,
    outflow_daily_cap: u64,
    outflow_daily_spent: u64,
}

/// Full control over the vault. Held by the user only.
public struct OwnerCap has key, store {
    id: UID,
    vault_id: ID,
}

/// Scoped capability for the agent. Cannot withdraw to an arbitrary address.
/// Becomes invalid if vault.agent_nonce is bumped past this cap's nonce.
public struct AgentCap has key, store {
    id: UID,
    vault_id: ID,
    nonce: u64,
}

// ============ Events ============

public struct WithdrawEvent has copy, drop {
    vault_id: ID,
    amount: u64,
    to: address,
    liquid_after: u64,
    by_agent: bool,
}

public struct SendEvent has copy, drop {
    vault_id: ID,
    amount: u64,
    to: address,
    liquid_after: u64,
    by_agent: bool,
}

public struct DepositEvent has copy, drop {
    vault_id: ID,
    amount: u64,
    liquid_after: u64,
}

public struct RebalanceEvent has copy, drop {
    vault_id: ID,
    direction: u8,
    amount: u64,
    liquid_after: u64,
    /// Current value of the savings position after the rebalance (principal + accrued).
    savings_value_after: u64,
    epoch: u64,
}

// ============ View helpers ============

public fun liquid_balance<T>(vault: &Vault<T>): u64 { balance::value(&vault.liquid) }

/// Current savings value (cTokens converted to underlying via Suilend ratio).
public fun savings_balance<P, T>(vault: &Vault<T>, venue: &YieldVenue<P, T>, lm: &LendingMarket<P>): u64 {
    if (option::is_none(&vault.savings_position)) return 0;
    yield_venue::current_value(lm, venue, option::borrow(&vault.savings_position))
}

public fun per_tx_cap<T>(vault: &Vault<T>): u64 { vault.per_tx_cap }
public fun daily_cap<T>(vault: &Vault<T>): u64 { vault.daily_cap }
public fun daily_spent<T>(vault: &Vault<T>): u64 { vault.daily_spent }
public fun agent_nonce<T>(vault: &Vault<T>): u64 { vault.agent_nonce }
public fun agent_cap_nonce(cap: &AgentCap): u64 { cap.nonce }
public fun has_savings_position<T>(vault: &Vault<T>): bool {
    option::is_some(&vault.savings_position)
}
public fun payout_address<T>(vault: &Vault<T>): address { vault.payout_address }
public fun outflow_per_tx_cap<T>(vault: &Vault<T>): u64 { vault.outflow_per_tx_cap }
public fun outflow_daily_cap<T>(vault: &Vault<T>): u64 { vault.outflow_daily_cap }
public fun outflow_daily_spent<T>(vault: &Vault<T>): u64 { vault.outflow_daily_spent }
public fun is_allowlisted<T>(vault: &Vault<T>, addr: address): bool {
    vec_set::contains(&vault.allowlist, &addr)
}

// ============ Owner setup ============

/// Create a new vault (shared) bound to `venue`. Returns OwnerCap to the caller.
/// `payout_address` is where agent withdrawals always land.
public fun create_vault<P, T>(
    venue: &YieldVenue<P, T>,
    payout_address: address,
    per_tx_cap: u64,
    daily_cap: u64,
    outflow_per_tx_cap: u64,
    outflow_daily_cap: u64,
    ctx: &mut TxContext,
): OwnerCap {
    let uid = object::new(ctx);
    let vault_id = object::uid_to_inner(&uid);
    transfer::share_object(Vault<T> {
        id: uid,
        liquid: balance::zero(),
        savings_position: option::none(),
        venue_id: object::id(venue),
        per_tx_cap,
        daily_cap,
        daily_spent: 0,
        last_reset_epoch: ctx.epoch(),
        agent_nonce: 0,
        payout_address,
        allowlist: vec_set::empty(),
        outflow_per_tx_cap,
        outflow_daily_cap,
        outflow_daily_spent: 0,
    });
    OwnerCap { id: object::new(ctx), vault_id }
}

/// Mint an AgentCap tied to the current nonce.
public fun issue_agent_cap<T>(
    owner_cap: &OwnerCap,
    vault: &Vault<T>,
    ctx: &mut TxContext,
): AgentCap {
    assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
    AgentCap { id: object::new(ctx), vault_id: object::id(vault), nonce: vault.agent_nonce }
}

/// Bump the vault's agent_nonce, instantly invalidating every AgentCap.
public fun revoke<T>(owner_cap: &OwnerCap, vault: &mut Vault<T>) {
    assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
    vault.agent_nonce = vault.agent_nonce + 1;
}

/// Deposit coins into the liquid bucket. Permissionless — anyone can add funds.
/// Emits DepositEvent so Block 3's event listener can credit the depositor.
public fun deposit<T>(vault: &mut Vault<T>, coin: Coin<T>) {
    let amount = coin::value(&coin);
    balance::join(&mut vault.liquid, coin::into_balance(coin));
    event::emit(DepositEvent {
        vault_id: object::id(vault),
        amount,
        liquid_after: balance::value(&vault.liquid),
    });
}

/// Withdraw from the liquid bucket. Owner only — not callable by AgentCap.
public fun withdraw<T>(
    owner_cap: &OwnerCap,
    vault: &mut Vault<T>,
    amount: u64,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
    let coin = coin::from_balance(balance::split(&mut vault.liquid, amount), ctx);
    event::emit(WithdrawEvent {
        vault_id: object::id(vault),
        amount,
        to: ctx.sender(),
        liquid_after: balance::value(&vault.liquid),
        by_agent: false,
    });
    coin
}

/// Redeem the full savings position back to liquid. Owner only.
/// Uses withdraw_all to drain every cToken, avoiding rounding dust.
public fun redeem_position<P, T>(
    owner_cap: &OwnerCap,
    vault: &mut Vault<T>,
    venue: &mut YieldVenue<P, T>,
    lm: &mut LendingMarket<P>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
    assert!(object::id(venue) == vault.venue_id, EWrongVenue);
    if (option::is_none(&vault.savings_position)) return;

    let mut position = option::extract(&mut vault.savings_position);
    let coin = yield_venue::withdraw_all(lm, venue, clock, &mut position, ctx);
    balance::join(&mut vault.liquid, coin::into_balance(coin));
    yield_venue::destroy_zero_position(position);
}

// ============ Owner outflow management ============

/// Change where agent withdrawals are sent. Owner only.
public fun set_payout_address<T>(owner_cap: &OwnerCap, vault: &mut Vault<T>, addr: address) {
    assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
    vault.payout_address = addr;
}

/// Add an address to the agent send allowlist. Owner only.
public fun add_payee<T>(owner_cap: &OwnerCap, vault: &mut Vault<T>, addr: address) {
    assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
    vec_set::insert(&mut vault.allowlist, addr);
}

/// Remove an address from the agent send allowlist. Owner only.
public fun remove_payee<T>(owner_cap: &OwnerCap, vault: &mut Vault<T>, addr: address) {
    assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
    vec_set::remove(&mut vault.allowlist, &addr);
}

/// Update the separate outflow caps. Owner only.
public fun set_outflow_caps<T>(
    owner_cap: &OwnerCap,
    vault: &mut Vault<T>,
    per_tx: u64,
    daily: u64,
) {
    assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
    vault.outflow_per_tx_cap = per_tx;
    vault.outflow_daily_cap = daily;
}

/// Send `amount` from liquid to any `recipient`. Owner only — no allowlist, no outflow cap.
public fun owner_send<T>(
    owner_cap: &OwnerCap,
    vault: &mut Vault<T>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
    assert!(balance::value(&vault.liquid) >= amount, EInsufficientLiquid);
    let coin = coin::from_balance(balance::split(&mut vault.liquid, amount), ctx);
    event::emit(SendEvent {
        vault_id: object::id(vault),
        amount,
        to: recipient,
        liquid_after: balance::value(&vault.liquid),
        by_agent: false,
    });
    transfer::public_transfer(coin, recipient);
}

// ============ Agent entry ============

/// Transfer `amount` from liquid to `vault.payout_address`. Agent only.
/// The agent cannot choose a destination — it is always `payout_address`.
/// Guards: not revoked → per-tx outflow cap → daily outflow cap → sufficient liquid.
public fun agent_withdraw_to_owner<T>(
    agent_cap: &AgentCap,
    vault: &mut Vault<T>,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(agent_cap.vault_id == object::id(vault), EAgentRevoked);
    assert!(agent_cap.nonce == vault.agent_nonce, EAgentRevoked);

    let current_epoch = ctx.epoch();
    if (current_epoch > vault.last_reset_epoch) {
        vault.daily_spent = 0;
        vault.outflow_daily_spent = 0;
        vault.last_reset_epoch = current_epoch;
    };

    assert!(amount <= vault.outflow_per_tx_cap, EOutflowExceedsPerTxCap);
    assert!(vault.outflow_daily_spent + amount <= vault.outflow_daily_cap, EOutflowDailyCapExceeded);
    assert!(balance::value(&vault.liquid) >= amount, EInsufficientLiquid);

    vault.outflow_daily_spent = vault.outflow_daily_spent + amount;
    let payout = vault.payout_address;
    let coin = coin::from_balance(balance::split(&mut vault.liquid, amount), ctx);
    event::emit(WithdrawEvent {
        vault_id: object::id(vault),
        amount,
        to: payout,
        liquid_after: balance::value(&vault.liquid),
        by_agent: true,
    });
    transfer::public_transfer(coin, payout);
}

/// Transfer `amount` from liquid to `recipient`. Agent only.
/// `recipient` must be on the owner-managed allowlist.
/// Guards: not revoked → allowlisted → per-tx outflow cap → daily outflow cap → sufficient liquid.
public fun agent_send<T>(
    agent_cap: &AgentCap,
    vault: &mut Vault<T>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert!(agent_cap.vault_id == object::id(vault), EAgentRevoked);
    assert!(agent_cap.nonce == vault.agent_nonce, EAgentRevoked);
    assert!(vec_set::contains(&vault.allowlist, &recipient), ENotAllowlisted);

    let current_epoch = ctx.epoch();
    if (current_epoch > vault.last_reset_epoch) {
        vault.daily_spent = 0;
        vault.outflow_daily_spent = 0;
        vault.last_reset_epoch = current_epoch;
    };

    assert!(amount <= vault.outflow_per_tx_cap, EOutflowExceedsPerTxCap);
    assert!(vault.outflow_daily_spent + amount <= vault.outflow_daily_cap, EOutflowDailyCapExceeded);
    assert!(balance::value(&vault.liquid) >= amount, EInsufficientLiquid);

    vault.outflow_daily_spent = vault.outflow_daily_spent + amount;
    let coin = coin::from_balance(balance::split(&mut vault.liquid, amount), ctx);
    event::emit(SendEvent {
        vault_id: object::id(vault),
        amount,
        to: recipient,
        liquid_after: balance::value(&vault.liquid),
        by_agent: true,
    });
    transfer::public_transfer(coin, recipient);
}

/// OwnerCap-gated sweep/topup — unrestricted (no per-tx or daily caps).
///
/// Routing mirrors `rebalance`: SWEEP deposits to Suilend, TOPUP redeems.
/// Emits the same RebalanceEvent so event listeners see owner and agent moves identically.
/// This is what the user calls from their zkLogin-signed transaction.
public fun owner_rebalance<P, T>(
    owner_cap: &OwnerCap,
    vault: &mut Vault<T>,
    venue: &mut YieldVenue<P, T>,
    lm: &mut LendingMarket<P>,
    clock: &Clock,
    direction: u8,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
    assert!(object::id(venue) == vault.venue_id, EWrongVenue);

    let current_epoch = ctx.epoch();
    let savings_value_after: u64;
    let amount_emitted: u64;

    if (direction == SWEEP) {
        assert!(balance::value(&vault.liquid) >= amount, EInsufficientLiquid);
        let coin = coin::from_balance(balance::split(&mut vault.liquid, amount), ctx);

        if (option::is_none(&vault.savings_position)) {
            let pos = yield_venue::deposit(lm, venue, clock, coin, ctx);
            option::fill(&mut vault.savings_position, pos);
        } else {
            yield_venue::extend_position(lm, venue, clock, option::borrow_mut(&mut vault.savings_position), coin, ctx);
        };

        savings_value_after = yield_venue::current_value(
            lm, venue, option::borrow(&vault.savings_position),
        );
        amount_emitted = amount;
    } else if (direction == TOPUP) {
        assert!(option::is_some(&vault.savings_position), ENoSavingsPosition);
        let out = yield_venue::withdraw(lm, venue, clock, option::borrow_mut(&mut vault.savings_position), amount, ctx);
        amount_emitted = coin::value(&out);
        balance::join(&mut vault.liquid, coin::into_balance(out));

        if (yield_venue::position_principal(option::borrow(&vault.savings_position)) == 0) {
            let empty = option::extract(&mut vault.savings_position);
            yield_venue::destroy_zero_position(empty);
            savings_value_after = 0;
        } else {
            savings_value_after = yield_venue::current_value(
                lm, venue, option::borrow(&vault.savings_position),
            );
        };
    } else {
        abort EInvalidDirection
    };

    event::emit(RebalanceEvent {
        vault_id: object::id(vault),
        direction,
        amount: amount_emitted,
        liquid_after: balance::value(&vault.liquid),
        savings_value_after,
        epoch: current_epoch,
    });
}

/// Move `amount` between liquid and Suilend in the given `direction`.
///
/// SWEEP (0): splits `amount` from liquid → Suilend deposit (extends or creates position).
/// TOPUP  (1): withdraws `amount` of value from Suilend → liquid.
///             Emits actual coin value (may differ from `amount` by dust).
///
/// Guards: nonce validity → wrong venue → per-tx cap → daily cap → source balance.
/// Cannot send funds to an arbitrary address — moves are vault ↔ venue only.
public fun rebalance<P, T>(
    agent_cap: &AgentCap,
    vault: &mut Vault<T>,
    venue: &mut YieldVenue<P, T>,
    lm: &mut LendingMarket<P>,
    clock: &Clock,
    direction: u8,
    amount: u64,
    ctx: &mut TxContext,
) {
    // Capability checks.
    assert!(agent_cap.vault_id == object::id(vault), EAgentRevoked);
    assert!(agent_cap.nonce == vault.agent_nonce, EAgentRevoked);
    assert!(object::id(venue) == vault.venue_id, EWrongVenue);

    // Per-tx cap (checked against requested amount).
    assert!(amount <= vault.per_tx_cap, EExceedsPerTxCap);

    // Daily cap — reset on new epoch.
    let current_epoch = ctx.epoch();
    if (current_epoch > vault.last_reset_epoch) {
        vault.daily_spent = 0;
        vault.outflow_daily_spent = 0;
        vault.last_reset_epoch = current_epoch;
    };
    assert!(vault.daily_spent + amount <= vault.daily_cap, EDailyCapExceeded);

    let savings_value_after: u64;
    let amount_emitted: u64;

    if (direction == SWEEP) {
        assert!(balance::value(&vault.liquid) >= amount, EInsufficientLiquid);
        let coin = coin::from_balance(balance::split(&mut vault.liquid, amount), ctx);

        if (option::is_none(&vault.savings_position)) {
            let pos = yield_venue::deposit(lm, venue, clock, coin, ctx);
            option::fill(&mut vault.savings_position, pos);
        } else {
            yield_venue::extend_position(lm, venue, clock, option::borrow_mut(&mut vault.savings_position), coin, ctx);
        };

        savings_value_after = yield_venue::current_value(
            lm, venue, option::borrow(&vault.savings_position),
        );
        amount_emitted = amount;
    } else if (direction == TOPUP) {
        assert!(option::is_some(&vault.savings_position), ENoSavingsPosition);
        let out = yield_venue::withdraw(lm, venue, clock, option::borrow_mut(&mut vault.savings_position), amount, ctx);
        amount_emitted = coin::value(&out);
        balance::join(&mut vault.liquid, coin::into_balance(out));

        if (yield_venue::position_principal(option::borrow(&vault.savings_position)) == 0) {
            let empty = option::extract(&mut vault.savings_position);
            yield_venue::destroy_zero_position(empty);
            savings_value_after = 0;
        } else {
            savings_value_after = yield_venue::current_value(
                lm, venue, option::borrow(&vault.savings_position),
            );
        };
    } else {
        abort EInvalidDirection
    };

    vault.daily_spent = vault.daily_spent + amount;

    event::emit(RebalanceEvent {
        vault_id: object::id(vault),
        direction,
        amount: amount_emitted,
        liquid_after: balance::value(&vault.liquid),
        savings_value_after,
        epoch: current_epoch,
    });
}

// ============ Test helpers ============

#[test_only]
public fun sweep(): u8 { SWEEP }

#[test_only]
public fun topup(): u8 { TOPUP }
