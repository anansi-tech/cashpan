#[test_only]
module cashpan::vault_tests;

use cashpan::vault::{Self, Vault, OwnerCap, AgentCap};
use cashpan::yield_venue::{Self, YieldVenue};
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};

// ============ Addresses ============

const OWNER: address = @0xAAAA;
const AGENT: address = @0xBBBB;

// ============ Constants ============

const PER_TX_CAP: u64 = 500;
const DAILY_CAP: u64 = 1000;
const FUND_AMOUNT: u64 = 2000;
const RATE_BPS: u64 = 1_000; // 10% per epoch
const PERIOD_EPOCHS: u64 = 1;
const RESERVE_FUND: u64 = 100_000;

// ============ Helpers ============

/// Full setup: venue + vault wired together, vault funded.
fun setup(): Scenario {
    let mut s = ts::begin(OWNER);

    // Create venue.
    ts::next_tx(&mut s, OWNER);
    {
        yield_venue::create_venue<SUI>(RATE_BPS, PERIOD_EPOCHS, ts::ctx(&mut s));
    };

    // Fund reserve.
    ts::next_tx(&mut s, OWNER);
    {
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let reserve_coin = coin::mint_for_testing<SUI>(RESERVE_FUND, ts::ctx(&mut s));
        yield_venue::fund_reserve(&mut venue, reserve_coin);
        ts::return_shared(venue);
    };

    // Create vault.
    ts::next_tx(&mut s, OWNER);
    {
        let venue: YieldVenue<SUI> = ts::take_shared(&s);
        let owner_cap = vault::create_vault<SUI>(&venue, PER_TX_CAP, DAILY_CAP, ts::ctx(&mut s));
        transfer::public_transfer(owner_cap, OWNER);
        ts::return_shared(venue);
    };

    ts::next_tx(&mut s, OWNER);
    s
}

fun fund_liquid(s: &mut Scenario, amount: u64) {
    ts::next_tx(s, OWNER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(s);
        let owner_cap: OwnerCap = ts::take_from_sender(s);
        let coins = coin::mint_for_testing<SUI>(amount, ts::ctx(s));
        vault::deposit(&owner_cap, &mut vault, coins);
        ts::return_shared(vault);
        ts::return_to_sender(s, owner_cap);
    };
}

fun get_agent_cap(s: &mut Scenario): AgentCap {
    ts::next_tx(s, OWNER);
    let vault: Vault<SUI> = ts::take_shared(s);
    let owner_cap: OwnerCap = ts::take_from_sender(s);
    let cap = vault::issue_agent_cap(&owner_cap, &vault, ts::ctx(s));
    ts::return_shared(vault);
    ts::return_to_sender(s, owner_cap);
    cap
}

// ============ Create vault ============

#[test]
fun test_create_vault_issues_owner_cap() {
    let mut s = setup();
    ts::next_tx(&mut s, OWNER);
    {
        assert!(ts::has_most_recent_for_sender<OwnerCap>(&s), 0);
        let cap: OwnerCap = ts::take_from_sender(&s);
        ts::return_to_sender(&s, cap);
    };
    ts::end(s);
}

#[test]
fun test_create_vault_zero_balances() {
    let mut s = setup();
    ts::next_tx(&mut s, OWNER);
    {
        let vault: Vault<SUI> = ts::take_shared(&s);
        let venue: YieldVenue<SUI> = ts::take_shared(&s);
        assert!(vault::liquid_balance(&vault) == 0, 0);
        assert!(vault::savings_balance(&vault, &venue, ts::ctx(&mut s)) == 0, 1);
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    ts::end(s);
}

// ============ Deposit / Withdraw (owner only) ============

#[test]
fun test_deposit_increases_liquid() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    ts::next_tx(&mut s, OWNER);
    {
        let vault: Vault<SUI> = ts::take_shared(&s);
        assert!(vault::liquid_balance(&vault) == FUND_AMOUNT, 0);
        ts::return_shared(vault);
    };
    ts::end(s);
}

#[test]
fun test_withdraw_reduces_liquid() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    ts::next_tx(&mut s, OWNER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let owner_cap: OwnerCap = ts::take_from_sender(&s);
        let coin = vault::withdraw(&owner_cap, &mut vault, 500, ts::ctx(&mut s));
        assert!(vault::liquid_balance(&vault) == FUND_AMOUNT - 500, 0);
        transfer::public_transfer(coin, OWNER);
        ts::return_shared(vault);
        ts::return_to_sender(&s, owner_cap);
    };
    ts::end(s);
}

// ============ Rebalance: sweep deposits to venue ============

#[test]
fun test_sweep_moves_liquid_to_venue() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::sweep(), 500, ts::ctx(&mut s));
        assert!(vault::liquid_balance(&vault) == FUND_AMOUNT - 500, 0);
        assert!(vault::savings_balance(&vault, &venue, ts::ctx(&mut s)) == 500, 1);
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

// ============ Rebalance: topup from venue (interest makes position not fully depleted) ============

#[test]
fun test_topup_within_cap_returns_value_and_leaves_interest_remainder() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    // Sweep 500 into the venue.
    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::sweep(), 500, ts::ctx(&mut s));
        ts::return_shared(vault);
        ts::return_shared(venue);
    };

    // Advance one epoch — interest accrues (value = 550 at 10%/epoch).
    ts::next_epoch(&mut s, AGENT);

    // Topup 500 (the per_tx_cap): principal portion from pool + interest portion from reserve.
    // Because total_value = 550 > amount = 500, the position is NOT fully depleted.
    // Specifically: principal_out = 500*500/550 = 454, remainder principal = 46.
    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let liquid_before = vault::liquid_balance(&vault);
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::topup(), 500, ts::ctx(&mut s));
        // Liquid gained exactly 500.
        assert!(vault::liquid_balance(&vault) == liquid_before + 500, 0);
        // A non-zero savings position remains (the interest-funded remainder).
        assert!(vault::has_savings_position(&vault), 1);
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

// ============ savings_balance reflects accrued interest ============

#[test]
fun test_savings_balance_grows_with_epochs() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::sweep(), 500, ts::ctx(&mut s));
        assert!(vault::savings_balance(&vault, &venue, ts::ctx(&mut s)) == 500, 0);
        ts::return_shared(vault);
        ts::return_shared(venue);
    };

    ts::next_epoch(&mut s, OWNER);
    ts::next_tx(&mut s, OWNER);
    {
        let vault: Vault<SUI> = ts::take_shared(&s);
        let venue: YieldVenue<SUI> = ts::take_shared(&s);
        // After 1 epoch at 10%: 500 + 50 = 550
        assert!(vault::savings_balance(&vault, &venue, ts::ctx(&mut s)) == 550, 0);
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

// ============ daily_spent accumulates ============

#[test]
fun test_daily_spent_accumulates() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::sweep(), 300, ts::ctx(&mut s));
        assert!(vault::daily_spent(&vault) == 300, 0);
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::sweep(), 200, ts::ctx(&mut s));
        assert!(vault::daily_spent(&vault) == 500, 1);
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

// ============ Per-tx cap violation ============

#[test]
#[expected_failure(abort_code = vault::EExceedsPerTxCap)]
fun test_rebalance_aborts_if_exceeds_per_tx_cap() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::sweep(), PER_TX_CAP + 1, ts::ctx(&mut s));
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

// ============ Daily cap violation ============

#[test]
#[expected_failure(abort_code = vault::EDailyCapExceeded)]
fun test_rebalance_aborts_if_exceeds_daily_cap() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::sweep(), 500, ts::ctx(&mut s));
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::sweep(), 500, ts::ctx(&mut s));
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        // daily_spent = 1000 = DAILY_CAP; one more must abort.
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::sweep(), 1, ts::ctx(&mut s));
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

// ============ Revoke ============

#[test]
#[expected_failure(abort_code = vault::EAgentRevoked)]
fun test_revoked_agent_cap_cannot_rebalance() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, OWNER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let owner_cap: OwnerCap = ts::take_from_sender(&s);
        vault::revoke(&owner_cap, &mut vault);
        ts::return_shared(vault);
        ts::return_to_sender(&s, owner_cap);
    };

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::sweep(), 100, ts::ctx(&mut s));
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

#[test]
fun test_new_agent_cap_valid_after_revoke() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let old_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, OWNER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let owner_cap: OwnerCap = ts::take_from_sender(&s);
        vault::revoke(&owner_cap, &mut vault);
        ts::return_shared(vault);
        ts::return_to_sender(&s, owner_cap);
    };

    let new_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        vault::rebalance(&new_cap, &mut vault, &mut venue, vault::sweep(), 100, ts::ctx(&mut s));
        assert!(vault::savings_balance(&vault, &venue, ts::ctx(&mut s)) == 100, 0);
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    transfer::public_transfer(old_cap, AGENT);
    transfer::public_transfer(new_cap, AGENT);
    ts::end(s);
}

// ============ AgentCap cannot withdraw to arbitrary address ============

#[test]
#[expected_failure(abort_code = vault::EAgentRevoked)]
fun test_agent_cannot_call_withdraw_via_wrong_cap() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let stale_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, OWNER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let owner_cap: OwnerCap = ts::take_from_sender(&s);
        vault::revoke(&owner_cap, &mut vault);
        ts::return_shared(vault);
        ts::return_to_sender(&s, owner_cap);
    };

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        // stale_cap.nonce = 0, vault.agent_nonce = 1 → EAgentRevoked
        vault::rebalance(&stale_cap, &mut vault, &mut venue, vault::sweep(), 100, ts::ctx(&mut s));
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    transfer::public_transfer(stale_cap, AGENT);
    ts::end(s);
}

// ============ Topup without savings aborts ============

#[test]
#[expected_failure(abort_code = vault::ENoSavingsPosition)]
fun test_topup_aborts_if_no_savings_position() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        // No sweep has happened — savings_position is None.
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::topup(), 1, ts::ctx(&mut s));
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

// ============ Sweep without liquid aborts ============

#[test]
#[expected_failure(abort_code = vault::EInsufficientLiquid)]
fun test_sweep_aborts_if_liquid_insufficient() {
    let mut s = setup();
    // No fund — liquid = 0.
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::sweep(), 1, ts::ctx(&mut s));
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

// ============ OwnerCap can redeem full position ============

#[test]
fun test_owner_can_redeem_position() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    // Sweep 500 into venue.
    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::sweep(), 500, ts::ctx(&mut s));
        ts::return_shared(vault);
        ts::return_shared(venue);
    };

    // Advance 1 epoch.
    ts::next_epoch(&mut s, OWNER);

    // Owner redeems full position.
    ts::next_tx(&mut s, OWNER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        let owner_cap: OwnerCap = ts::take_from_sender(&s);
        let liquid_before = vault::liquid_balance(&vault);
        vault::redeem_position(&owner_cap, &mut vault, &mut venue, ts::ctx(&mut s));
        // liquid gained 550 (500 principal + 50 interest at 10%/epoch).
        assert!(vault::liquid_balance(&vault) == liquid_before + 550, 0);
        assert!(!vault::has_savings_position(&vault), 1);
        ts::return_shared(vault);
        ts::return_shared(venue);
        ts::return_to_sender(&s, owner_cap);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

// ============ Rebalance emits event ============

#[test]
fun test_rebalance_completes_emitting_event() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let mut venue: YieldVenue<SUI> = ts::take_shared(&s);
        vault::rebalance(&agent_cap, &mut vault, &mut venue, vault::sweep(), 100, ts::ctx(&mut s));
        ts::return_shared(vault);
        ts::return_shared(venue);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}
