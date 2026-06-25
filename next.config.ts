import type { NextConfig } from 'next';

const config: NextConfig = {
  // Don't bundle @mysten/sui — it's a Node.js package and must resolve at runtime
  serverExternalPackages: ['@mysten/sui'],
};

export default config;
