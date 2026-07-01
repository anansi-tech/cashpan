/// Cashpan YieldVenue — Suilend cToken wrapper.
///
/// Holds commingled CToken<P,T> balance across all vaults; each Position
/// tracks its cToken share. Underlying value accrues as the Suilend reserve
/// ratio rises from borrower interest — no fixed rate, no reserve fund.
///
/// P = market witness (suilend::suilend::MAIN_POOL)
/// T = underlying coin (native USDC)
///
/// // SWAP POINT: deposit / extend_position / withdraw / current_value
/// // call into Suilend main-pool lending_market.
module cashpan::yield_venue;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::clock::Clock;
use suilend::lending_market::{Self, LendingMarket, RateLimiterExemption};
use suilend::reserve::{Self, CToken};
use suilend::decimal;

const EWithdrawExceedsValue: u64 = 1;

/// Per-vault savings record. `ctoken_amount` is this vault's share of the
/// commingled `venue.ctokens` pool. `has store` so it lives inside Vault<T>.
public struct Position has store { ctoken_amount: u64 }

/// Shared venue bound to one Suilend reserve. All vaults write into the same
/// commingled `ctokens` balance; each Position tracks its cToken count.
public struct YieldVenue<phantom P, phantom T> has key {
    id: UID,
    ctokens: Balance<CToken<P, T>>,
    reserve_array_index: u64,
}

/// Create and share the venue. `reserve_array_index` is the position of the
/// target reserve in the LendingMarket's reserves vector — resolved at deploy
/// time by matching coinType, never hardcoded in source.
public fun create_venue<P, T>(reserve_array_index: u64, ctx: &mut TxContext) {
    transfer::share_object(YieldVenue<P, T> {
        id: object::new(ctx),
        ctokens: balance::zero(),
        reserve_array_index,
    });
}

/// Returns the cToken count held by this position (proxy for "principal").
public fun position_principal(pos: &Position): u64 { pos.ctoken_amount }

/// Deposit underlying coins → mint cTokens → open a new Position.
public fun deposit<P, T>(
    lm: &mut LendingMarket<P>,
    venue: &mut YieldVenue<P, T>,
    clock: &Clock,
    coin: Coin<T>,
    ctx: &mut TxContext,
): Position {
    let ct = lending_market::deposit_liquidity_and_mint_ctokens<P, T>(
        lm, venue.reserve_array_index, clock, coin, ctx,
    );
    let minted = coin::value(&ct);
    balance::join(&mut venue.ctokens, coin::into_balance(ct));
    Position { ctoken_amount: minted }
}

/// Deposit more underlying → mint additional cTokens → extend existing Position.
public fun extend_position<P, T>(
    lm: &mut LendingMarket<P>,
    venue: &mut YieldVenue<P, T>,
    clock: &Clock,
    pos: &mut Position,
    coin: Coin<T>,
    ctx: &mut TxContext,
) {
    let ct = lending_market::deposit_liquidity_and_mint_ctokens<P, T>(
        lm, venue.reserve_array_index, clock, coin, ctx,
    );
    pos.ctoken_amount = pos.ctoken_amount + coin::value(&ct);
    balance::join(&mut venue.ctokens, coin::into_balance(ct));
}

/// Underlying value of this position: floor(ctoken_amount * ctoken_ratio).
/// Read-only — does not mutate on-chain state.
public fun current_value<P, T>(
    lm: &LendingMarket<P>,
    venue: &YieldVenue<P, T>,
    pos: &Position,
): u64 {
    let ratio = {
        let reserves = lending_market::reserves(lm);
        let reserve = vector::borrow(reserves, venue.reserve_array_index);
        reserve::ctoken_ratio(reserve)
    };
    decimal::floor(decimal::mul(decimal::from(pos.ctoken_amount), ratio))
}

/// Withdraw `amount` of underlying value from the position.
/// Converts to cTokens (ceil division), clamps to held cTokens, redeems via Suilend.
/// Returned coin amount may differ from `amount` by ±1 (integer rounding dust).
/// Caps in vault.move are checked against requested `amount`, not actual.
public fun withdraw<P, T>(
    lm: &mut LendingMarket<P>,
    venue: &mut YieldVenue<P, T>,
    clock: &Clock,
    pos: &mut Position,
    amount: u64,
    ctx: &mut TxContext,
): Coin<T> {
    let ct_needed = {
        let ratio = {
            let reserves = lending_market::reserves(lm);
            let reserve = vector::borrow(reserves, venue.reserve_array_index);
            reserve::ctoken_ratio(reserve)
        };
        let value = decimal::floor(decimal::mul(decimal::from(pos.ctoken_amount), ratio));
        assert!(amount <= value, EWithdrawExceedsValue);
        decimal::ceil(decimal::div(decimal::from(amount), ratio))
    };
    let ct_take = if (ct_needed > pos.ctoken_amount) { pos.ctoken_amount } else { ct_needed };
    pos.ctoken_amount = pos.ctoken_amount - ct_take;
    let ct = coin::from_balance(balance::split(&mut venue.ctokens, ct_take), ctx);
    lending_market::redeem_ctokens_and_withdraw_liquidity<P, T>(
        lm,
        venue.reserve_array_index,
        clock,
        ct,
        option::none<RateLimiterExemption<P, T>>(),
        ctx,
    )
}

/// Redeem ALL cTokens in the position. Used by vault::redeem_position to
/// guarantee a full drain with no rounding dust left behind.
public fun withdraw_all<P, T>(
    lm: &mut LendingMarket<P>,
    venue: &mut YieldVenue<P, T>,
    clock: &Clock,
    pos: &mut Position,
    ctx: &mut TxContext,
): Coin<T> {
    let ct_take = pos.ctoken_amount;
    pos.ctoken_amount = 0;
    let ct = coin::from_balance(balance::split(&mut venue.ctokens, ct_take), ctx);
    lending_market::redeem_ctokens_and_withdraw_liquidity<P, T>(
        lm,
        venue.reserve_array_index,
        clock,
        ct,
        option::none<RateLimiterExemption<P, T>>(),
        ctx,
    )
}

/// Assert the position is fully drained before dropping it.
public fun destroy_zero_position(pos: Position) {
    let Position { ctoken_amount } = pos;
    assert!(ctoken_amount == 0, EWithdrawExceedsValue);
}
