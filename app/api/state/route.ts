import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getActiveVault } from '@/lib/db/vault-registry';
import { getBalances, getAgentActivity } from '@/lib/read-layer';
import { computeProposals } from '@/lib/brain';
import type { WalletCoin } from '@/lib/brain';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';

export const dynamic = 'force-dynamic';

const COIN_TYPE = process.env.COIN_TYPE ?? '';
const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet') as 'testnet';

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

  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(NETWORK), network: NETWORK });

  const [balances, coinsResult, activity] = await Promise.all([
    getBalances(vault.vaultId),
    client.getCoins({ owner: vault.payoutAddress, coinType: COIN_TYPE, limit: 50 }),
    getAgentActivity(10, vault.vaultId, addressToName),
  ]);

  const earnings = {
    accrued: (BigInt(balances.savingsValue) - BigInt(balances.savingsPrincipal)).toString(),
    aprBps: balances.rateBps,
  };

  const walletCoins: WalletCoin[] = coinsResult.data.map((c) => ({
    coinObjectId: c.coinObjectId,
    balance: c.balance,
  }));

  return NextResponse.json({
    balances,
    earnings,
    activity,
    walletCoins,
    proposals: computeProposals(walletCoins, balances, settings),
    contacts,
    settings,
  });
}
