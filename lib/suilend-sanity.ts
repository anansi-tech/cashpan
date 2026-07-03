/**
 * Startup assertion: confirms the COIN_TYPE reserve exists in the live
 * Suilend LendingMarket via the SDK (no RESERVE_INDEX env var needed).
 *
 * Called once per server process from page.tsx. Non-fatal — warns to stderr
 * if the reserve is missing so the operator knows something is wrong.
 */

import { SuilendClient, LENDING_MARKET_ID, LENDING_MARKET_TYPE } from '@suilend/sdk/client';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { graphqlClient } from './graphql';

const COIN_TYPE = process.env.COIN_TYPE ?? '';

let checked = false;

export async function validateReserveIndex(): Promise<void> {
  if (checked) return;
  checked = true;
  if (!COIN_TYPE) return;
  try {
    const suilend = await SuilendClient.initialize(LENDING_MARKET_ID, LENDING_MARKET_TYPE, graphqlClient() as unknown as SuiGrpcClient);
    const idx = suilend.findReserveArrayIndex(COIN_TYPE);
    if (idx < 0) {
      console.warn(`[CashPan] WARN: COIN_TYPE "${COIN_TYPE}" not found in Suilend reserves — APR will show 0.`);
    }
  } catch {
    // Non-fatal — skip if GraphQL unreachable at startup
  }
}
