import { cookies } from 'next/headers';
import { getBalances, getEarnings, getAgentActivity } from '@/lib/read-layer';
import { validateReserveIndex } from '@/lib/suilend-sanity';
import { getActiveVault } from '@/lib/db/vault-registry';
import { suiNetwork } from '@/lib/sui';
import { LENDING_MARKET_ID, LENDING_MARKET_TYPE } from '@/lib/graphql';
import { LiveDashboard } from '@/components/LiveDashboard';
import { ActivityFeed } from '@/components/ActivityFeed';
import { AsidePanel } from '@/components/AsidePanel';
import type { VaultTxContext } from '@/lib/vault-tx';
import { SignIn } from '@/components/SignIn';
import { ProvisionVault } from '@/components/ProvisionVault';
import { OnboardingModal } from '@/components/OnboardingModal';
import { ProposalBanner } from '@/components/ProposalBanner';
import { VaultDataProvider } from '@/components/VaultDataProvider';
import { AccountMenu } from '@/components/AccountMenu';

export const dynamic = 'force-dynamic';

export default async function Page() {
  void validateReserveIndex(); // fire-and-forget; warns to stderr if RESERVE_INDEX has drifted
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
    <div
      className="page-root"
      style={{
        background: 'var(--color-bg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        height: '100vh',
      }}
    >
      <OnboardingModal />

      <VaultDataProvider initial={{ balances, earnings, activity }}>
        {/* Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.875rem 1.5rem',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <span style={{ fontSize: '1.15rem' }}>🍳</span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '1.05rem',
                fontWeight: 700,
                color: 'var(--color-savings)',
                letterSpacing: '-0.02em',
              }}
            >
              CashPan
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div className="epoch-badge" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--color-savings)',
                  display: 'inline-block',
                  boxShadow: '0 0 8px var(--color-savings)',
                }}
              />
              <span style={{ color: 'var(--color-muted)', fontSize: '0.78rem' }}>
                Sui {suiNetwork()} · epoch {balances.currentEpoch}
              </span>
            </div>

            <AccountMenu address={vault.payoutAddress} vaultId={vault.vaultId} />
          </div>
        </header>

        {/* Two-column layout fills remaining height */}
        <div className="dashboard-grid" style={{ flex: 1 }}>
          {/* Left: live dashboard + activity feed */}
          <main
            style={{
              padding: '1.25rem 1.5rem',
              overflowY: 'auto',
              borderRight: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0',
            }}
          >
            <ProposalBanner vaultCtx={vaultCtx} />
            <LiveDashboard />
            <ActivityFeed />
          </main>

          {/* Right: Money Talks + Contacts */}
          <aside style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            <AsidePanel vaultCtx={vaultCtx} />
          </aside>
        </div>
      </VaultDataProvider>
    </div>
  );

}

