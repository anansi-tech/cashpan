#[test_only]
module cashpan::yield_venue_tests;

use cashpan::yield_venue::{Self, YieldVenue, Position};
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};

// ============ Addresses ============

const ADMIN: address = @0xAAAA;

// ============ Constants ============

// 10% per epoch (rate_bps=1000, period_epochs=1) — easy to reason about in tests.
const RATE_BPS: u64 = 1_000;
const PERIOD_EPOCHS: u64 = 1;
const RESERVE_FUND: u64 = 100_000;
const DEPOSIT_AMOUNT: u64 = 10_000;

// ============ Helpers ============

fun setup(): Scenario {
    let mut s = ts::begin(ADMIN);
    ts::next_tx(&mut s, ADMIN);
    {
        yield_venue::create_venue<SUI>(RATE_BPS, PERIOD_EPOCHS, ts::ctx(&mut s));
    };
    ts::next_tx(&mut s, ADMIN);
    {
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let reserve_coin = coin::mint_for_testing<SUI>(RESERVE_FUND, ts::ctx(&mut s));
        yield_venue::fund_reserve(&mut venue, reserve_coin);
        ts::return_shared(venue);
    };
    ts::next_tx(&mut s, ADMIN);
    s
}

// ============ Create + fund ============

#[test]
fun test_create_venue_zero_balances() {
    let mut s = setup();
    ts::next_tx(&mut s, ADMIN);
    {
        let venue: YieldVenue<SUI> = ts::take_shared(&s);
        assert!(yield_venue::pool_balance(&venue) == 0, 0);
        assert!(yield_venue::reserve_balance(&venue) == RESERVE_FUND, 1);
        ts::return_shared(venue);
    };
    ts::end(s);
}

// ============ Deposit ============

#[test]
fun test_deposit_creates_position() {
    let mut s = setup();
    ts::next_tx(&mut s, ADMIN);
    {
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let coin = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, ts::ctx(&mut s));
        let pos = yield_venue::deposit(&mut venue, coin, ts::ctx(&mut s));
        assert!(yield_venue::position_principal(&pos) == DEPOSIT_AMOUNT, 0);
        assert!(yield_venue::pool_balance(&venue) == DEPOSIT_AMOUNT, 1);
        yield_venue::destroy_zero_position(pos); // principal != 0 but OK — we just need to drop it
        ts::return_shared(venue);
    };
    ts::end(s);
}

// ============ current_value grows with epochs ============

#[test]
fun test_current_value_equals_principal_at_entry_epoch() {
    let mut s = setup();
    ts::next_tx(&mut s, ADMIN);
    {
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let coin = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, ts::ctx(&mut s));
        let pos = yield_venue::deposit(&mut venue, coin, ts::ctx(&mut s));
        // No epoch has elapsed — value == principal.
        let value = yield_venue::current_value(&venue, &pos, ts::ctx(&mut s));
        assert!(value == DEPOSIT_AMOUNT, 0);
        yield_venue::destroy_zero_position(pos);
        ts::return_shared(venue);
    };
    ts::end(s);
}

#[test]
fun test_current_value_increases_after_epoch_advance() {
    let mut s = setup();

    // Deposit at epoch N.
    ts::next_tx(&mut s, ADMIN);
    let pos: Position;
    {
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let coin = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, ts::ctx(&mut s));
        pos = yield_venue::deposit(&mut venue, coin, ts::ctx(&mut s));
        ts::return_shared(venue);
    };

    // Advance 1 epoch.
    ts::next_epoch(&mut s, ADMIN);
    ts::next_tx(&mut s, ADMIN);
    {
        let venue: YieldVenue<SUI> = ts::take_shared(&s);
        let value = yield_venue::current_value(&venue, &pos, ts::ctx(&mut s));
        // After 1 epoch: value = 10_000 + 10_000 * 1_000 * 1 / (10_000 * 1) = 10_000 + 1_000 = 11_000
        let expected = DEPOSIT_AMOUNT + (DEPOSIT_AMOUNT * RATE_BPS * 1) / (10_000 * PERIOD_EPOCHS);
        assert!(value == expected, 0);
        ts::return_shared(venue);
    };

    yield_venue::destroy_zero_position(pos);
    ts::end(s);
}

#[test]
fun test_current_value_scales_with_epochs() {
    let mut s = setup();

    ts::next_tx(&mut s, ADMIN);
    let pos: Position;
    {
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let coin = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, ts::ctx(&mut s));
        pos = yield_venue::deposit(&mut venue, coin, ts::ctx(&mut s));
        ts::return_shared(venue);
    };

    // Advance 3 epochs.
    ts::next_epoch(&mut s, ADMIN);
    ts::next_epoch(&mut s, ADMIN);
    ts::next_epoch(&mut s, ADMIN);
    ts::next_tx(&mut s, ADMIN);
    {
        let venue: YieldVenue<SUI> = ts::take_shared(&s);
        let value = yield_venue::current_value(&venue, &pos, ts::ctx(&mut s));
        // value = 10_000 + 10_000 * 1_000 * 3 / (10_000 * 1) = 10_000 + 3_000 = 13_000
        let expected = DEPOSIT_AMOUNT + (DEPOSIT_AMOUNT * RATE_BPS * 3) / (10_000 * PERIOD_EPOCHS);
        assert!(value == expected, 0);
        ts::return_shared(venue);
    };

    yield_venue::destroy_zero_position(pos);
    ts::end(s);
}

// ============ Withdraw with interest ============

#[test]
fun test_full_withdraw_returns_principal_plus_interest() {
    let mut s = setup();

    ts::next_tx(&mut s, ADMIN);
    let mut pos: Position;
    {
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let coin = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, ts::ctx(&mut s));
        pos = yield_venue::deposit(&mut venue, coin, ts::ctx(&mut s));
        ts::return_shared(venue);
    };

    ts::next_epoch(&mut s, ADMIN);

    ts::next_tx(&mut s, ADMIN);
    {
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let total_value = yield_venue::current_value(&venue, &pos, ts::ctx(&mut s));
        // expected: 11_000 (10_000 principal + 1_000 interest at 10%/epoch)
        let expected_value = DEPOSIT_AMOUNT + (DEPOSIT_AMOUNT * RATE_BPS) / (10_000 * PERIOD_EPOCHS);
        assert!(total_value == expected_value, 0);

        let coin = yield_venue::withdraw(&mut venue, &mut pos, total_value, ts::ctx(&mut s));
        // Full value returned.
        assert!(coin::value(&coin) == total_value, 1);
        // position.principal is now 0.
        assert!(yield_venue::position_principal(&pos) == 0, 2);
        // reserve was drawn down by the interest portion.
        assert!(yield_venue::reserve_balance(&venue) == RESERVE_FUND - (total_value - DEPOSIT_AMOUNT), 3);

        transfer::public_transfer(coin, ADMIN);
        ts::return_shared(venue);
    };

    yield_venue::destroy_zero_position(pos);
    ts::end(s);
}

#[test]
fun test_partial_withdraw_reduces_principal_and_resets_epoch() {
    let mut s = setup();

    ts::next_tx(&mut s, ADMIN);
    let mut pos: Position;
    {
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let coin = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, ts::ctx(&mut s));
        pos = yield_venue::deposit(&mut venue, coin, ts::ctx(&mut s));
        ts::return_shared(venue);
    };

    ts::next_epoch(&mut s, ADMIN);

    ts::next_tx(&mut s, ADMIN);
    {
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        // total_value = 11_000. Withdraw half = 5_500.
        let half = 5_500u64;
        let coin = yield_venue::withdraw(&mut venue, &mut pos, half, ts::ctx(&mut s));
        assert!(coin::value(&coin) == half, 0);
        // Principal reduced: 10_000 * 5_500 / 11_000 = 5_000 withdrawn; remainder = 5_000.
        assert!(yield_venue::position_principal(&pos) == 5_000, 1);
        transfer::public_transfer(coin, ADMIN);
        ts::return_shared(venue);
    };

    yield_venue::destroy_zero_position(pos);
    ts::end(s);
}

// ============ Reserve insufficient ============

#[test]
#[expected_failure(abort_code = yield_venue::EReserveInsufficient)]
fun test_withdraw_aborts_if_reserve_empty() {
    let mut s = ts::begin(ADMIN);

    // Create a venue with NO reserve funding.
    ts::next_tx(&mut s, ADMIN);
    {
        yield_venue::create_venue<SUI>(RATE_BPS, PERIOD_EPOCHS, ts::ctx(&mut s));
    };

    ts::next_tx(&mut s, ADMIN);
    let mut pos: Position;
    {
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let coin = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, ts::ctx(&mut s));
        pos = yield_venue::deposit(&mut venue, coin, ts::ctx(&mut s));
        ts::return_shared(venue);
    };

    // Advance epoch so interest accrues.
    ts::next_epoch(&mut s, ADMIN);

    ts::next_tx(&mut s, ADMIN);
    {
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let total_value = yield_venue::current_value(&venue, &pos, ts::ctx(&mut s));
        // This must abort — reserve is empty but interest is owed.
        let coin = yield_venue::withdraw(&mut venue, &mut pos, total_value, ts::ctx(&mut s));
        transfer::public_transfer(coin, ADMIN);
        ts::return_shared(venue);
    };

    yield_venue::destroy_zero_position(pos);
    ts::end(s);
}

// ============ extend_position ============

#[test]
fun test_extend_position_adds_principal_and_resets_epoch() {
    let mut s = setup();

    ts::next_tx(&mut s, ADMIN);
    let mut pos: Position;
    {
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let coin = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, ts::ctx(&mut s));
        pos = yield_venue::deposit(&mut venue, coin, ts::ctx(&mut s));
        ts::return_shared(venue);
    };

    ts::next_epoch(&mut s, ADMIN);

    // Extend with an additional DEPOSIT_AMOUNT — accrued interest folds into principal.
    ts::next_tx(&mut s, ADMIN);
    {
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let coin2 = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, ts::ctx(&mut s));
        yield_venue::extend_position(&mut venue, &mut pos, coin2, ts::ctx(&mut s));
        // New principal: 10_000 (original) + 1_000 (accrued interest) + 10_000 (new) = 21_000
        let expected_principal = DEPOSIT_AMOUNT + (DEPOSIT_AMOUNT * RATE_BPS) / (10_000 * PERIOD_EPOCHS) + DEPOSIT_AMOUNT;
        assert!(yield_venue::position_principal(&pos) == expected_principal, 0);
        // No elapsed epochs since extend just happened — value == principal.
        let value = yield_venue::current_value(&venue, &pos, ts::ctx(&mut s));
        assert!(value == expected_principal, 1);
        ts::return_shared(venue);
    };

    yield_venue::destroy_zero_position(pos);
    ts::end(s);
}
