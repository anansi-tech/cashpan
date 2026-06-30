import type { NextConfig } from 'next';

const config: NextConfig = {
  // Don't bundle @mysten/sui — it's a Node.js package and must resolve at runtime
  serverExternalPackages: ['@mysten/sui'],
  // Single-source coin config: derive NEXT_PUBLIC_* from server-side vars
  // so COIN_DECIMALS/COIN_SYMBOL/COIN_TYPE in .env is the only place to set them.
  env: {
    NEXT_PUBLIC_COIN_TYPE: process.env.COIN_TYPE,
    NEXT_PUBLIC_COIN_DECIMALS: process.env.COIN_DECIMALS,
    NEXT_PUBLIC_COIN_SYMBOL: process.env.COIN_SYMBOL,
  },
};

export default config;
