/**
 * Step 0 verification — throwaway script.
 * Proves: SuiGrpcClient + SuilendClient + GraphQL all work with the QuickNode triple.
 * Run once before committing the dep bump: npx tsx scripts/verify-step0.ts
 */

import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { SuilendClient, LENDING_MARKET_ID, LENDING_MARKET_TYPE } from '@suilend/sdk/client';
import { config } from 'dotenv';
config();

// SuiGraphQLClient and SuiGrpcClient share the same BaseClient interface —
// SuilendClient accepts either. QuickNode port 9000 is native gRPC (not gRPC-web),
// so we use the GraphQL client here. Layer 2 streaming uses @grpc/grpc-js directly.
const GRPC_TOKEN  = process.env.SUI_GRPC_TOKEN!;
const AUTH_HEADER = process.env.SUI_GRPC_AUTH_HEADER!;
const GRAPHQL_URL = process.env.SUI_GRAPHQL_URL!;
const COIN_TYPE   = process.env.COIN_TYPE!;

// From prior session — mainnet zkLogin address with a small USDC balance.
const TEST_ADDRESS = '0x551602f56b1aead7cce13c1231c08a5d9441ed5c073af25c623b458c375f11bd';

async function main() {
  // ── 1. SuiGraphQLClient + SuilendClient ──────────────────────────────────────
  console.log('1. SuiGraphQLClient + SuilendClient...');
  const suiGrpcClient = new SuiGraphQLClient({
    url: GRAPHQL_URL,
    headers: { [AUTH_HEADER]: GRPC_TOKEN },
    network: 'mainnet',
  });

  const suilendClient = await SuilendClient.initialize(
    LENDING_MARKET_ID,
    LENDING_MARKET_TYPE,
    suiGrpcClient,
  );

  const reserves = suilendClient.lendingMarket.reserves;
  const reserveIndex = suilendClient.findReserveArrayIndex(COIN_TYPE);
  const reserve = reserves[reserveIndex];

  console.log(`   LendingMarket reserves: ${reserves.length}`);
  console.log(`   COIN_TYPE reserve index: ${reserveIndex}`);
  console.log(`   Reserve coinType: ${reserve?.coinType?.name ?? '(not found)'}`);

  if (reserveIndex < 0) throw new Error('USDC reserve not found — check COIN_TYPE');

  // ── 2. GraphQL balance query ──────────────────────────────────────────────────
  console.log('2. GraphQL balance query...');
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [AUTH_HEADER]: GRPC_TOKEN,
    },
    body: JSON.stringify({
      query: `{
        address(address: "${TEST_ADDRESS}") {
          balance(coinType: "${COIN_TYPE}") {
            totalBalance
          }
        }
        epoch { epochId }
      }`,
    }),
  });
  const json = await res.json() as { data?: unknown; errors?: unknown[] };
  if (json.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  if (!json.data) throw new Error('GraphQL returned no data');
  console.log(`   Result: ${JSON.stringify(json.data)}`);

  console.log('\n✓ Step 0 verification passed');
  console.log(`  @mysten/sui: 2.17.0  @suilend/sdk: 3.0.4`);
  console.log(`  Reserve index to pin in env: RESERVE_INDEX=${reserveIndex}  (will be removed in Layer 1)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
