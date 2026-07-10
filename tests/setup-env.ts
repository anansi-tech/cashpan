// Runs before any test module is imported (jest setupFiles).
// coin-config.ts reads COIN_DECIMALS at module load, so it must be set here,
// not in beforeAll.
process.env.COIN_DECIMALS = '6';
