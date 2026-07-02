import type { NextConfig } from 'next';

const config: NextConfig = {
  // Resolve at runtime via Node.js (not Webpack) — @suilend/sdk pulls in
  // @pythnetwork/pyth-sui-js (CJS) which require()s @mysten/sui (ESM).
  // Webpack can't cross that boundary; Node.js 22+ handles it natively.
  serverExternalPackages: ['@mysten/sui', '@suilend/sdk'],
  // Single-source coin config: derive NEXT_PUBLIC_* from server-side vars
  // so COIN_DECIMALS/COIN_SYMBOL/COIN_TYPE in .env is the only place to set them.
  env: {
    NEXT_PUBLIC_COIN_TYPE: process.env.COIN_TYPE,
    NEXT_PUBLIC_COIN_DECIMALS: process.env.COIN_DECIMALS,
    NEXT_PUBLIC_COIN_SYMBOL: process.env.COIN_SYMBOL,
  },
};

export default config;
