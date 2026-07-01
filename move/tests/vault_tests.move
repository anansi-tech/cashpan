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
const PAYOUT: address = @0xCCCC;
const PAYEE: address = @0xDDDD;
const STRANGER: address = @0xEEEE;

// ============ Constants ============

const PER_TX_CAP: u64 = 500;
const DAILY_CAP: u64 = 1000;
const FUND_AMOUNT: u64 = 2000;
const OUTFLOW_PER_TX_CAP: u64 = 300;
const OUTFLOW_DAILY_CAP: u64 = 600;

// Placeholder market witness for unit tests — no real LendingMarket needed.
#[test_only]
public struct MOCK_MARKET has drop {}

// ============ Helpers ============

/// Full setup: venue + vault wired together. No reserve funding (real yield via Suilend).
fun setup(): Scenario {
    let mut s = ts::begin(OWNER);

    // Create venue (no LendingMarket needed at creation time).
    ts::next_tx(&mut s, OWNER);
    {
        yield_venue::create_venue<MOCK_MARKET, SUI>(0, ts::ctx(&mut s));
    };

    // Create vault.
    ts::next_tx(&mut s, OWNER);
    {
        let venue: YieldVenue<MOCK_MARKET, SUI> = ts::take_shared(&s);
        let owner_cap = vault::create_vault<MOCK_MARKET, SUI>(
            &venue, PAYOUT, PER_TX_CAP, DAILY_CAP, OUTFLOW_PER_TX_CAP, OUTFLOW_DAILY_CAP,
            ts::ctx(&mut s),
        );
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
        let coins = coin::mint_for_testing<SUI>(amount, ts::ctx(s));
        vault::deposit(&mut vault, coins);
        ts::return_shared(vault);
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
fun test_create_vault_no_savings_position() {
    let mut s = setup();
    ts::next_tx(&mut s, OWNER);
    {
        let vault: Vault<SUI> = ts::take_shared(&s);
        assert!(vault::liquid_balance(&vault) == 0, 0);
        assert!(!vault::has_savings_position(&vault), 1);
        ts::return_shared(vault);
    };
    ts::end(s);
}

// ============ Deposit / Withdraw (liquid) ============

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

// ============ Permissionless deposit ============

#[test]
fun test_deposit_from_non_owner_succeeds() {
    let mut s = setup();
    ts::next_tx(&mut s, STRANGER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let coins = coin::mint_for_testing<SUI>(500, ts::ctx(&mut s));
        vault::deposit(&mut vault, coins);
        assert!(vault::liquid_balance(&vault) == 500, 0);
        ts::return_shared(vault);
    };
    ts::end(s);
}

#[test]
fun test_deposit_emits_deposit_event() {
    let mut s = setup();
    let effects = ts::next_tx(&mut s, OWNER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let coins = coin::mint_for_testing<SUI>(777, ts::ctx(&mut s));
        vault::deposit(&mut vault, coins);
        ts::return_shared(vault);
    };
    let effects2 = ts::next_tx(&mut s, OWNER);
    assert!(ts::num_user_events(&effects2) == 1, 0);
    let _ = effects;
    ts::end(s);
}

// ============ Nonce / revoke ============

#[test]
#[expected_failure(abort_code = vault::EAgentRevoked)]
fun test_revoked_agent_cannot_withdraw_to_owner() {
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
        vault::agent_withdraw_to_owner(&agent_cap, &mut vault, 100, ts::ctx(&mut s));
        ts::return_shared(vault);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

// ============ owner_send ============

#[test]
fun test_owner_send_reaches_arbitrary_recipient() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);

    ts::next_tx(&mut s, OWNER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let owner_cap: OwnerCap = ts::take_from_sender(&s);
        vault::owner_send(&owner_cap, &mut vault, 200, STRANGER, ts::ctx(&mut s));
        assert!(vault::liquid_balance(&vault) == FUND_AMOUNT - 200, 0);
        ts::return_shared(vault);
        ts::return_to_sender(&s, owner_cap);
    };
    ts::end(s);
}

#[test]
#[expected_failure(abort_code = vault::EInsufficientLiquid)]
fun test_owner_send_aborts_if_liquid_insufficient() {
    let mut s = setup();
    ts::next_tx(&mut s, OWNER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let owner_cap: OwnerCap = ts::take_from_sender(&s);
        vault::owner_send(&owner_cap, &mut vault, 1, STRANGER, ts::ctx(&mut s));
        ts::return_shared(vault);
        ts::return_to_sender(&s, owner_cap);
    };
    ts::end(s);
}

// ============ Allowlist management ============

#[test]
fun test_add_and_remove_payee() {
    let mut s = setup();

    ts::next_tx(&mut s, OWNER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let owner_cap: OwnerCap = ts::take_from_sender(&s);
        assert!(!vault::is_allowlisted(&vault, PAYEE), 0);
        vault::add_payee(&owner_cap, &mut vault, PAYEE);
        assert!(vault::is_allowlisted(&vault, PAYEE), 1);
        vault::remove_payee(&owner_cap, &mut vault, PAYEE);
        assert!(!vault::is_allowlisted(&vault, PAYEE), 2);
        ts::return_shared(vault);
        ts::return_to_sender(&s, owner_cap);
    };
    ts::end(s);
}

#[test]
fun test_set_payout_address() {
    let mut s = setup();

    ts::next_tx(&mut s, OWNER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let owner_cap: OwnerCap = ts::take_from_sender(&s);
        assert!(vault::payout_address(&vault) == PAYOUT, 0);
        vault::set_payout_address(&owner_cap, &mut vault, STRANGER);
        assert!(vault::payout_address(&vault) == STRANGER, 1);
        ts::return_shared(vault);
        ts::return_to_sender(&s, owner_cap);
    };
    ts::end(s);
}

// ============ agent_withdraw_to_owner ============

#[test]
fun test_agent_withdraw_to_owner_lands_at_payout_address() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        vault::agent_withdraw_to_owner(&agent_cap, &mut vault, 100, ts::ctx(&mut s));
        assert!(vault::liquid_balance(&vault) == FUND_AMOUNT - 100, 0);
        assert!(vault::outflow_daily_spent(&vault) == 100, 1);
        ts::return_shared(vault);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

#[test]
#[expected_failure(abort_code = vault::EOutflowExceedsPerTxCap)]
fun test_agent_withdraw_aborts_if_exceeds_outflow_per_tx_cap() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        vault::agent_withdraw_to_owner(&agent_cap, &mut vault, OUTFLOW_PER_TX_CAP + 1, ts::ctx(&mut s));
        ts::return_shared(vault);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

#[test]
#[expected_failure(abort_code = vault::EOutflowDailyCapExceeded)]
fun test_agent_withdraw_aborts_if_exceeds_outflow_daily_cap() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        vault::agent_withdraw_to_owner(&agent_cap, &mut vault, 300, ts::ctx(&mut s));
        ts::return_shared(vault);
    };
    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        vault::agent_withdraw_to_owner(&agent_cap, &mut vault, 300, ts::ctx(&mut s));
        ts::return_shared(vault);
    };
    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        vault::agent_withdraw_to_owner(&agent_cap, &mut vault, 1, ts::ctx(&mut s));
        ts::return_shared(vault);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

#[test]
fun test_agent_outflow_daily_cap_resets_next_epoch() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        vault::agent_withdraw_to_owner(&agent_cap, &mut vault, 300, ts::ctx(&mut s));
        ts::return_shared(vault);
    };
    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        vault::agent_withdraw_to_owner(&agent_cap, &mut vault, 300, ts::ctx(&mut s));
        assert!(vault::outflow_daily_spent(&vault) == 600, 0);
        ts::return_shared(vault);
    };

    ts::next_epoch(&mut s, AGENT);
    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        vault::agent_withdraw_to_owner(&agent_cap, &mut vault, 300, ts::ctx(&mut s));
        assert!(vault::outflow_daily_spent(&vault) == 300, 1);
        ts::return_shared(vault);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

#[test]
#[expected_failure(abort_code = vault::EInsufficientLiquid)]
fun test_agent_withdraw_aborts_if_liquid_insufficient() {
    let mut s = setup();
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        vault::agent_withdraw_to_owner(&agent_cap, &mut vault, 1, ts::ctx(&mut s));
        ts::return_shared(vault);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

// ============ agent_send ============

#[test]
fun test_agent_send_to_allowlisted_recipient_succeeds() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, OWNER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let owner_cap: OwnerCap = ts::take_from_sender(&s);
        vault::add_payee(&owner_cap, &mut vault, PAYEE);
        ts::return_shared(vault);
        ts::return_to_sender(&s, owner_cap);
    };

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        vault::agent_send(&agent_cap, &mut vault, 100, PAYEE, ts::ctx(&mut s));
        assert!(vault::liquid_balance(&vault) == FUND_AMOUNT - 100, 0);
        assert!(vault::outflow_daily_spent(&vault) == 100, 1);
        ts::return_shared(vault);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

#[test]
#[expected_failure(abort_code = vault::ENotAllowlisted)]
fun test_agent_send_to_non_allowlisted_aborts() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        vault::agent_send(&agent_cap, &mut vault, 100, STRANGER, ts::ctx(&mut s));
        ts::return_shared(vault);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

#[test]
#[expected_failure(abort_code = vault::EOutflowExceedsPerTxCap)]
fun test_agent_send_aborts_if_exceeds_outflow_per_tx_cap() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, OWNER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let owner_cap: OwnerCap = ts::take_from_sender(&s);
        vault::add_payee(&owner_cap, &mut vault, PAYEE);
        ts::return_shared(vault);
        ts::return_to_sender(&s, owner_cap);
    };

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        vault::agent_send(&agent_cap, &mut vault, OUTFLOW_PER_TX_CAP + 1, PAYEE, ts::ctx(&mut s));
        ts::return_shared(vault);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}

#[test]
#[expected_failure(abort_code = vault::EAgentRevoked)]
fun test_revoked_agent_cannot_send() {
    let mut s = setup();
    fund_liquid(&mut s, FUND_AMOUNT);
    let agent_cap = get_agent_cap(&mut s);

    ts::next_tx(&mut s, OWNER);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        let owner_cap: OwnerCap = ts::take_from_sender(&s);
        vault::add_payee(&owner_cap, &mut vault, PAYEE);
        vault::revoke(&owner_cap, &mut vault);
        ts::return_shared(vault);
        ts::return_to_sender(&s, owner_cap);
    };

    ts::next_tx(&mut s, AGENT);
    {
        let mut vault: Vault<SUI> = ts::take_shared(&s);
        vault::agent_send(&agent_cap, &mut vault, 100, PAYEE, ts::ctx(&mut s));
        ts::return_shared(vault);
    };
    transfer::public_transfer(agent_cap, AGENT);
    ts::end(s);
}
