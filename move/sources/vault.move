/// Cashpan Vault — non-custodial liquidity buffer agent.
///
/// Owner keeps OwnerCap (full control). Agent holds AgentCap (scoped: rebalance only,
/// capped per-tx and daily, revocable by owner at any time via nonce bump).
module cashpan::vault;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;

// ============ Direction constants ============

const SWEEP: u8 = 0; // liquid → savings
const TOPUP: u8 = 1; // savings → liquid

// ============ Error codes ============

const EAgentRevoked: u64 = 0;
const EExceedsPerTxCap: u64 = 1;
const EDailyCapExceeded: u64 = 2;
const EInsufficientSavings: u64 = 3;
const EInsufficientLiquid: u64 = 4;
const EInvalidDirection: u64 = 5;
const ENotOwner: u64 = 6;

// ============ Objects ============

/// Shared object holding the two balances. All agent operations go through this.
public struct Vault<phantom T> has key {
    id: UID,
    liquid: Balance<T>,
    savings: Balance<T>,
    per_tx_cap: u64,
    daily_cap: u64,
    /// Cumulative amount moved by the agent in the current epoch window.
    daily_spent: u64,
    /// Epoch at which daily_spent was last reset.
    last_reset_epoch: u64,
    /// Bumped by revoke(); AgentCap checks this matches its own nonce.
    agent_nonce: u64,
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

public struct RebalanceEvent has copy, drop {
    vault_id: ID,
    direction: u8,
    amount: u64,
    liquid_after: u64,
    savings_after: u64,
    epoch: u64,
}

// ============ View helpers ============

public fun liquid_balance<T>(vault: &Vault<T>): u64 { balance::value(&vault.liquid) }

public fun savings_balance<T>(vault: &Vault<T>): u64 { balance::value(&vault.savings) }

public fun per_tx_cap<T>(vault: &Vault<T>): u64 { vault.per_tx_cap }

public fun daily_cap<T>(vault: &Vault<T>): u64 { vault.daily_cap }

public fun daily_spent<T>(vault: &Vault<T>): u64 { vault.daily_spent }

public fun agent_nonce<T>(vault: &Vault<T>): u64 { vault.agent_nonce }

public fun agent_cap_nonce(cap: &AgentCap): u64 { cap.nonce }

// ============ Owner setup ============

/// Create a new vault (shared) and return an OwnerCap to the caller.
public fun create_vault<T>(per_tx_cap: u64, daily_cap: u64, ctx: &mut TxContext): OwnerCap {
    let uid = object::new(ctx);
    let vault_id = object::uid_to_inner(&uid);
    let vault = Vault<T> {
        id: uid,
        liquid: balance::zero(),
        savings: balance::zero(),
        per_tx_cap,
        daily_cap,
        daily_spent: 0,
        last_reset_epoch: ctx.epoch(),
        agent_nonce: 0,
    };
    transfer::share_object(vault);
    OwnerCap { id: object::new(ctx), vault_id }
}

/// Mint an AgentCap tied to the current nonce. Previous caps with stale nonces
/// will fail the validity check in rebalance().
public fun issue_agent_cap<T>(
    owner_cap: &OwnerCap,
    vault: &Vault<T>,
    ctx: &mut TxContext,
): AgentCap {
    assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
    AgentCap { id: object::new(ctx), vault_id: object::id(vault), nonce: vault.agent_nonce }
}

/// Bump the vault's agent_nonce, instantly invalidating every AgentCap issued
/// before this call. The owner retains full control via OwnerCap.
public fun revoke<T>(owner_cap: &OwnerCap, vault: &mut Vault<T>) {
    assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
    vault.agent_nonce = vault.agent_nonce + 1;
}

/// Deposit coins into the liquid bucket. Owner only.
public fun deposit<T>(owner_cap: &OwnerCap, vault: &mut Vault<T>, coin: Coin<T>) {
    assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
    balance::join(&mut vault.liquid, coin::into_balance(coin));
}

/// Withdraw from the liquid bucket. Owner only — cannot be called by AgentCap.
public fun withdraw<T>(
    owner_cap: &OwnerCap,
    vault: &mut Vault<T>,
    amount: u64,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
    coin::from_balance(balance::split(&mut vault.liquid, amount), ctx)
}

// ============ Agent entry ============

/// Move `amount` between liquid and savings in the given `direction`.
/// Asserts:
///   - AgentCap is not revoked (nonce matches)
///   - amount <= per_tx_cap
///   - daily_spent + amount <= daily_cap (resets on new epoch)
///   - sufficient balance exists in the source bucket
///
/// Cannot move funds to an arbitrary address — only between the vault's own buckets.
public fun rebalance<T>(
    agent_cap: &AgentCap,
    vault: &mut Vault<T>,
    direction: u8,
    amount: u64,
    ctx: &TxContext,
) {
    // Validity: cap must belong to this vault and not be revoked.
    assert!(agent_cap.vault_id == object::id(vault), EAgentRevoked);
    assert!(agent_cap.nonce == vault.agent_nonce, EAgentRevoked);

    // Per-tx cap.
    assert!(amount <= vault.per_tx_cap, EExceedsPerTxCap);

    // Daily cap — reset counter when epoch advances.
    let current_epoch = ctx.epoch();
    if (current_epoch > vault.last_reset_epoch) {
        vault.daily_spent = 0;
        vault.last_reset_epoch = current_epoch;
    };
    assert!(vault.daily_spent + amount <= vault.daily_cap, EDailyCapExceeded);

    if (direction == SWEEP) {
        assert!(balance::value(&vault.liquid) >= amount, EInsufficientLiquid);
        let swept = balance::split(&mut vault.liquid, amount);
        balance::join(&mut vault.savings, swept);
    } else if (direction == TOPUP) {
        assert!(balance::value(&vault.savings) >= amount, EInsufficientSavings);
        let topped = balance::split(&mut vault.savings, amount);
        balance::join(&mut vault.liquid, topped);
    } else {
        abort EInvalidDirection
    };

    vault.daily_spent = vault.daily_spent + amount;

    event::emit(RebalanceEvent {
        vault_id: object::id(vault),
        direction,
        amount,
        liquid_after: balance::value(&vault.liquid),
        savings_after: balance::value(&vault.savings),
        epoch: current_epoch,
    });
}

// ============ Test helpers ============

#[test_only]
public fun sweep(): u8 { SWEEP }

#[test_only]
public fun topup(): u8 { TOPUP }

#[test_only]
public fun create_vault_for_testing<T>(
    per_tx_cap: u64,
    daily_cap: u64,
    ctx: &mut TxContext,
): (OwnerCap, ID) {
    let owner_cap = create_vault<T>(per_tx_cap, daily_cap, ctx);
    let vault_id = owner_cap.vault_id;
    (owner_cap, vault_id)
}
