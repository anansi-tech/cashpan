/// Cashpan YieldVenue — fixed-rate reserve-funded yield boundary.
///
/// Proves the architecture on testnet: funds genuinely move into a venue,
/// value genuinely accrues over epochs, and a withdraw returns more than
/// was deposited. Mainnet swaps this module for Sui Dollar / Scallop /
/// Navi / Suilend behind the same four-function boundary.
///
/// // SWAP POINT (mainnet): replace deposit / withdraw / current_value /
/// // fund_reserve with the real protocol's entry points. The vault call
/// // sites are in cashpan::vault::rebalance (sweep and topup branches).
module cashpan::yield_venue;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};

// ============ Error codes ============

const EReserveInsufficient: u64 = 0;
const EWithdrawExceedsValue: u64 = 1;

// ============ Objects ============

/// Per-vault accounting record. `has store` so it lives inside Vault<T>.
/// No UID — it is not a top-level object.
public struct Position has store {
    principal: u64,
    entry_epoch: u64,
}

/// Shared venue. `pool` holds deposited principal; `reserve` funds interest.
///
/// rate_bps / period_epochs define the fixed APR:
///   value = principal + principal * rate_bps * elapsed_epochs
///                       / (10_000 * period_epochs)
public struct YieldVenue<phantom T> has key {
    id: UID,
    pool: Balance<T>,
    reserve: Balance<T>,
    rate_bps: u64,
    period_epochs: u64,
}

// ============ View helpers ============

public fun rate_bps<T>(venue: &YieldVenue<T>): u64 { venue.rate_bps }

public fun period_epochs<T>(venue: &YieldVenue<T>): u64 { venue.period_epochs }

public fun reserve_balance<T>(venue: &YieldVenue<T>): u64 { balance::value(&venue.reserve) }

public fun pool_balance<T>(venue: &YieldVenue<T>): u64 { balance::value(&venue.pool) }

public fun position_principal(pos: &Position): u64 { pos.principal }

public fun position_entry_epoch(pos: &Position): u64 { pos.entry_epoch }

/// Current value of a position: principal + accrued interest.
public fun current_value<T>(venue: &YieldVenue<T>, pos: &Position, ctx: &TxContext): u64 {
    let elapsed = ctx.epoch() - pos.entry_epoch;
    pos.principal + accrued_interest(pos.principal, venue.rate_bps, elapsed, venue.period_epochs)
}

// ============ Internal math ============

fun accrued_interest(principal: u64, rate_bps: u64, elapsed: u64, period_epochs: u64): u64 {
    if (elapsed == 0 || principal == 0 || period_epochs == 0) return 0;
    let numerator = (principal as u128) * (rate_bps as u128) * (elapsed as u128);
    let denominator = 10_000u128 * (period_epochs as u128);
    (numerator / denominator) as u64
}

// ============ Setup ============

/// Create and share a new YieldVenue. Call once during deployment.
public fun create_venue<T>(rate_bps: u64, period_epochs: u64, ctx: &mut TxContext) {
    transfer::share_object(YieldVenue<T> {
        id: object::new(ctx),
        pool: balance::zero(),
        reserve: balance::zero(),
        rate_bps,
        period_epochs,
    });
}

/// Pre-fund the reserve so it can pay out interest. Owner-controlled.
public fun fund_reserve<T>(venue: &mut YieldVenue<T>, coin: Coin<T>) {
    balance::join(&mut venue.reserve, coin::into_balance(coin));
}

// ============ Core API (the boundary) ============

/// Deposit principal into the venue; returns a fresh Position.
public fun deposit<T>(venue: &mut YieldVenue<T>, coin: Coin<T>, ctx: &TxContext): Position {
    let principal = coin::value(&coin);
    balance::join(&mut venue.pool, coin::into_balance(coin));
    Position { principal, entry_epoch: ctx.epoch() }
}

/// Extend an existing position with additional principal.
/// Accrued interest is realized first (folded into principal, reset entry_epoch).
/// Aborts if the reserve cannot cover interest already owed.
public fun extend_position<T>(
    venue: &mut YieldVenue<T>,
    position: &mut Position,
    coin: Coin<T>,
    ctx: &TxContext,
) {
    let current_epoch = ctx.epoch();
    let elapsed = current_epoch - position.entry_epoch;
    let accrued = accrued_interest(
        position.principal,
        venue.rate_bps,
        elapsed,
        venue.period_epochs,
    );

    if (accrued > 0) {
        assert!(balance::value(&venue.reserve) >= accrued, EReserveInsufficient);
        let interest_bal = balance::split(&mut venue.reserve, accrued);
        balance::join(&mut venue.pool, interest_bal);
        position.principal = position.principal + accrued;
    };

    position.principal = position.principal + coin::value(&coin);
    balance::join(&mut venue.pool, coin::into_balance(coin));
    position.entry_epoch = current_epoch;
}

/// Withdraw `amount` of total *value* (principal + proportional interest).
///
/// Pro-rata split: principal_out = position.principal * amount / total_value.
/// Interest portion is paid from `reserve`. Aborts if reserve is insufficient.
///
/// v1 simplification: remainder resets entry_epoch to now. Production uses
/// a share/exchange-rate model to avoid this epoch-reset compounding behaviour.
public fun withdraw<T>(
    venue: &mut YieldVenue<T>,
    position: &mut Position,
    amount: u64,
    ctx: &mut TxContext,
): Coin<T> {
    let current_epoch = ctx.epoch();
    let elapsed = current_epoch - position.entry_epoch;
    let accrued = accrued_interest(
        position.principal,
        venue.rate_bps,
        elapsed,
        venue.period_epochs,
    );
    let total_value = position.principal + accrued;

    assert!(amount <= total_value, EWithdrawExceedsValue);

    let principal_out = if (total_value > 0) {
        (position.principal * amount) / total_value
    } else {
        0
    };
    let interest_out = amount - principal_out;

    assert!(balance::value(&venue.reserve) >= interest_out, EReserveInsufficient);

    let mut out = balance::split(&mut venue.pool, principal_out);
    if (interest_out > 0) {
        let interest_bal = balance::split(&mut venue.reserve, interest_out);
        balance::join(&mut out, interest_bal);
    };

    position.principal = position.principal - principal_out;
    position.entry_epoch = current_epoch;

    coin::from_balance(out, ctx)
}

/// Destroy a fully-withdrawn (zero-principal) position.
public fun destroy_zero_position(position: Position) {
    let Position { principal: _, entry_epoch: _ } = position;
}

// ============ Test helpers ============

#[test_only]
public fun e_reserve_insufficient(): u64 { EReserveInsufficient }

#[test_only]
public fun e_withdraw_exceeds_value(): u64 { EWithdrawExceedsValue }
