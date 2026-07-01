import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getActiveVault } from '@/lib/db/vault-registry';
import { getBalances, getAgentActivity, getLiveAprBps } from '@/lib/read-layer';
import { computeProposals } from '@/lib/brain';
import { getCoinsRaw, suiNetwork } from '@/lib/sui';
import type { WalletCoin } from '@/lib/brain';

export const dynamic = 'force-dynamic';

const COIN_TYPE = process.env.COIN_TYPE ?? '';

export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const sub = cookieStore.get('cashpan-sub')?.value;
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const network = suiNetwork();
  const vault = await getActiveVault(sub, network);
  if (!vault) return NextResponse.json({ error: 'Vault not found' }, { status: 404 });

  const settings = { buffer: vault.buffer ?? '50', band: vault.band ?? '5' };
  const contacts = vault.contacts ?? [];
  const addressToName: Record<string, string> = {};
  for (const c of contacts) addressToName[c.address.toLowerCase()] = c.label;

  const [balancesResult, coinsResult, activityResult, aprResult] = await Promise.allSettled([
    getBalances(vault.vaultId),
    getCoinsRaw(vault.payoutAddress, COIN_TYPE),
    getAgentActivity(10, vault.vaultId, addressToName),
    getLiveAprBps(),
  ]);

  if (balancesResult.status === 'rejected') {
    console.error('[state] getBalances failed:', balancesResult.reason, { vaultId: vault.vaultId });
  }
  if (coinsResult.status === 'rejected') {
    console.error('[state] getCoins failed:', coinsResult.reason, { payoutAddress: vault.payoutAddress, COIN_TYPE });
  }

  const balances = balancesResult.status === 'fulfilled' ? balancesResult.value : null;
  const walletCoins: WalletCoin[] = coinsResult.status === 'fulfilled' ? coinsResult.value : [];
  const activity = activityResult.status === 'fulfilled' ? activityResult.value : [];
  const aprBps = aprResult.status === 'fulfilled' ? aprResult.value : 0;

  const savingsPrincipal = vault.savingsPrincipal ?? '0';
  const savingsValue = balances ? BigInt(balances.savingsValue) : 0n;
  const principalBig = BigInt(savingsPrincipal);
  const earnings = {
    accrued: (savingsValue > principalBig ? savingsValue - principalBig : 0n).toString(),
    aprBps: String(aprBps),
  };

  return NextResponse.json({
    balances,
    earnings,
    activity,
    walletCoins,
    proposals: balances ? computeProposals(walletCoins, balances, settings) : [],
    contacts,
    settings,
  });
}
