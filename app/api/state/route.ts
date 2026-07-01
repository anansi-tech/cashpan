import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getActiveVault } from '@/lib/db/vault-registry';
import { getBalances, getAgentActivity } from '@/lib/read-layer';
import { computeProposals } from '@/lib/brain';
import type { WalletCoin } from '@/lib/brain';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';

export const dynamic = 'force-dynamic';

const COIN_TYPE = process.env.COIN_TYPE ?? '';
const RPC_URL = process.env.SUI_RPC_URL ?? 'https://fullnode.mainnet.sui.io:443';
const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'mainnet') as 'mainnet' | 'testnet';

export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const sub = cookieStore.get('cashpan-sub')?.value;
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const vault = await getActiveVault(sub);
  if (!vault) return NextResponse.json({ error: 'Vault not found' }, { status: 404 });

  const settings = { buffer: vault.buffer ?? '50', band: vault.band ?? '5' };
  const contacts = vault.contacts ?? [];
  const addressToName: Record<string, string> = {};
  for (const c of contacts) addressToName[c.address.toLowerCase()] = c.label;

  const client = new SuiJsonRpcClient({ url: RPC_URL, network: NETWORK });

  const [balancesResult, coinsResult, activityResult] = await Promise.allSettled([
    getBalances(vault.vaultId),
    client.getCoins({ owner: vault.payoutAddress, coinType: COIN_TYPE, limit: 50 }),
    getAgentActivity(10, vault.vaultId, addressToName),
  ]);

  if (balancesResult.status === 'rejected') {
    console.error('[state] getBalances failed:', balancesResult.reason, { vaultId: vault.vaultId, payoutAddress: vault.payoutAddress, COIN_TYPE });
  }
  if (coinsResult.status === 'rejected') {
    console.error('[state] getCoins failed:', coinsResult.reason, { payoutAddress: vault.payoutAddress, COIN_TYPE });
  }

  const balances = balancesResult.status === 'fulfilled' ? balancesResult.value : null;
  const walletCoins: WalletCoin[] = coinsResult.status === 'fulfilled'
    ? coinsResult.value.data.map((c) => ({ coinObjectId: c.coinObjectId, balance: c.balance }))
    : [];
  const activity = activityResult.status === 'fulfilled' ? activityResult.value : [];

  const earnings = balances
    ? { accrued: (BigInt(balances.savingsValue) - BigInt(balances.savingsPrincipal)).toString(), aprBps: balances.rateBps }
    : { accrued: '0', aprBps: '0' };

  return NextResponse.json({
    balances,
    earnings,
    activity,
    walletCoins,
    proposals: balances ? computeProposals(walletCoins, balances, settings) : [],
    contacts,
    settings,
    debug: { payoutAddress: vault.payoutAddress, coinType: COIN_TYPE, rpcUrl: RPC_URL },
  });
}
