import { getBalances, getEarnings, getAgentActivity } from '@/lib/read-layer';
import { getActiveVault } from '@/lib/db/vault-registry';
import { LiveDashboard } from '@/components/LiveDashboard';
import { ActivityFeed } from '@/components/ActivityFeed';
import { ChatPanel } from '@/components/ChatPanel';
import { UserSwitcher } from '@/components/UserSwitcher';

export const dynamic = 'force-dynamic';

// Next.js 15: searchParams is a Promise in server components.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const { user } = await searchParams;
  const vault = await getActiveVault(user);

  if (!vault) {
    return (
      <div style={{ padding: '2rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
        No vault registered. Run:{' '}
        <code style={{ color: 'var(--color-savings)' }}>
          npm run create-vault -- --identity alice
        </code>
      </div>
    );
  }

  const { vaultId } = vault;

  const [balances, earnings, activity] = await Promise.all([
    getBalances(vaultId),
    getEarnings(vaultId),
    getAgentActivity(20, vaultId),
  ]);

  return (
    <div
      style={{
        height: '100vh',
        background: 'var(--color-bg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
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
          {/* Dev user switcher — Block 1 only; removed in Block 2 when zkLogin lands */}
          <UserSwitcher currentUser={vault.identityKey} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
              Sui testnet · epoch {balances.currentEpoch}
            </span>
          </div>
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
          <LiveDashboard initial={{ balances, earnings }} />
          <ActivityFeed initial={activity} />
        </main>

        {/* Right: Money Talks chat */}
        <aside
          style={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: '0.875rem 1.25rem',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: '0.85rem' }}>💬</span>
            <span
              style={{
                color: 'var(--color-text)',
                fontWeight: 600,
                fontSize: '0.875rem',
              }}
            >
              Money Talks
            </span>
          </div>

          <ChatPanel />
        </aside>
      </div>
    </div>
  );
}
