import { cookies } from 'next/headers';
import { getBalances, getEarnings, getAgentActivity } from '@/lib/read-layer';
import { validateReserveIndex } from '@/lib/suilend-sanity';
import { getActiveVault } from '@/lib/db/vault-registry';
import { suiNetwork } from '@/lib/sui';
import { LENDING_MARKET_ID, LENDING_MARKET_TYPE } from '@/lib/graphql';
import { AppShell } from '@/components/AppShell';
import type { VaultTxContext } from '@/lib/vault-tx';
import { SignIn } from '@/components/SignIn';
import { ProvisionVault } from '@/components/ProvisionVault';
import { OnboardingModal } from '@/components/OnboardingModal';
import { VaultDataProvider } from '@/components/VaultDataProvider';
import { AccountMenu } from '@/components/AccountMenu';

export const dynamic = 'force-dynamic';

export default async function Page() {
  void validateReserveIndex();
  const cookieStore = await cookies();
  const sub = cookieStore.get('cashpan-sub')?.value;

  if (!sub) return <SignIn />;

  const vault = await getActiveVault(sub, suiNetwork());

  if (!vault) {
    return (
      <ProvisionVault
        packageId={process.env.PACKAGE_ID!}
        pType={LENDING_MARKET_TYPE}
        venueId={process.env.VENUE_ID!}
        coinType={process.env.COIN_TYPE!}
      />
    );
  }

  const { vaultId } = vault;

  const vaultCtx: VaultTxContext = {
    packageId: process.env.PACKAGE_ID!,
    coinType: process.env.COIN_TYPE!,
    pType: LENDING_MARKET_TYPE,
    vaultId: vault.vaultId,
    ownerCapId: vault.ownerCapId,
    venueId: process.env.VENUE_ID!,
    lendingMarketId: LENDING_MARKET_ID,
    userAddress: vault.payoutAddress,
  };

  const [balances, earnings, activity] = await Promise.all([
    getBalances(vaultId),
    getEarnings(vaultId, vault.savingsPrincipal ?? '0'),
    getAgentActivity(10, vaultId),
  ]);

  return (
    <div className="page-root" style={{ background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100vh' }}>
      <OnboardingModal />

      <VaultDataProvider initial={{ balances, earnings, activity }}>
        {/* Header — border spans full width, content centered at 1200px */}
        <header style={{ borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <span style={{ fontSize: '1.15rem' }}>🍳</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-savings)', letterSpacing: '-0.02em' }}>
                CashPan
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div className="epoch-badge" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-savings)', display: 'inline-block', boxShadow: '0 0 8px var(--color-savings)' }} />
                <span style={{ color: 'var(--color-muted)', fontSize: '0.78rem' }}>Sui {suiNetwork()}</span>
                <span style={{ color: 'var(--color-muted-2)', fontSize: '0.78rem' }}>· epoch {balances.currentEpoch}</span>
              </div>
              <AccountMenu address={vault.payoutAddress} vaultId={vault.vaultId} />
            </div>
          </div>
        </header>

        {/* Main content — AppShell manages desktop grid + mobile layout */}
        <AppShell vaultCtx={vaultCtx} />
      </VaultDataProvider>
    </div>
  );
}
