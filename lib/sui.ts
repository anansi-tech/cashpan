export const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet';

export function suiNetwork(): 'mainnet' | 'testnet' {
  return NETWORK;
}
