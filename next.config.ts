import type { NextConfig } from 'next';

const config: NextConfig = {
  // Bundle the full suilend chain through Webpack so it handles all interop:
  //   - @suilend/sui-fe: `export * from "./lib"` (dir import, invalid in Node ESM)
  //   - @pythnetwork/pyth-sui-js (CJS): require()s @mysten/sui (ESM)
  //   - @mysten/sui must also be in transpilePackages so Webpack resolves the
  //     CJS→ESM require() internally (it can't emit an external require() against
  //     an ESM-typed package without erroring).
  transpilePackages: ['@mysten/sui', '@suilend/sdk', '@suilend/sui-fe', '@pythnetwork/pyth-sui-js'],
  // Single-source coin config: derive NEXT_PUBLIC_* from server-side vars
  // so COIN_DECIMALS/COIN_SYMBOL/COIN_TYPE in .env is the only place to set them.
  env: {
    NEXT_PUBLIC_COIN_TYPE: process.env.COIN_TYPE,
    NEXT_PUBLIC_COIN_DECIMALS: process.env.COIN_DECIMALS,
    NEXT_PUBLIC_COIN_SYMBOL: process.env.COIN_SYMBOL,
  },
};

export default config;
