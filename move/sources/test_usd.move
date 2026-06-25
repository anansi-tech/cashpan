/// 6-decimal test stablecoin for CashPan testnet.
///
/// Deployed by setup.ts alongside vault + yield_venue.
/// COIN_TYPE: <packageId>::test_usd::TEST_USD
/// Not deployed on mainnet — swap COIN_TYPE config to real USDC/Sui Dollar instead.
module cashpan::test_usd;

use sui::coin;
use sui::transfer;
use std::option;

public struct TEST_USD has drop {}

#[allow(deprecated_usage)]
fun init(witness: TEST_USD, ctx: &mut TxContext) {
    let (treasury_cap, metadata) = coin::create_currency(
        witness,
        6,
        b"TUSD",
        b"Test USD",
        b"Test stablecoin for CashPan testnet",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::public_transfer(treasury_cap, ctx.sender());
}

/// Mint `amount` base units of TEST_USD to `recipient`.
/// Called during setup to fund the vault and venue reserve.
public fun mint(
    cap: &mut coin::TreasuryCap<TEST_USD>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    coin::mint_and_transfer(cap, amount, recipient, ctx);
}
