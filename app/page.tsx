import { getBalances, getEarnings, getAgentActivity } from '@/lib/read-layer';
import { LiveDashboard } from '@/components/LiveDashboard';
import { ActivityFeed } from '@/components/ActivityFeed';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [balances, earnings, activity] = await Promise.all([
    getBalances(),
    getEarnings(),
    getAgentActivity(20),
  ]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-bg)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1rem 1.5rem',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <span style={{ fontSize: '1.25rem' }}>🍳</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '1.1rem',
              fontWeight: 700,
              color: 'var(--color-savings)',
              letterSpacing: '-0.02em',
            }}
          >
            CashPan
          </span>
        </div>

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
          <span style={{ color: 'var(--color-muted)', fontSize: '0.8rem' }}>
            Sui testnet · epoch {balances.currentEpoch}
          </span>
        </div>
      </header>

      {/* Two-column layout */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 400px',
          overflow: 'hidden',
        }}
      >
        {/* Left: live dashboard + activity feed */}
        <main
          style={{
            padding: '1.5rem',
            overflowY: 'auto',
            borderRight: '1px solid var(--color-border)',
          }}
        >
          <LiveDashboard initial={{ balances, earnings }} />
          <ActivityFeed initial={activity} />
        </main>

        {/* Right: Chat placeholder */}
        <aside style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div
            style={{
              padding: '1rem 1.25rem',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span style={{ fontSize: '0.9rem' }}>💬</span>
            <span style={{ color: 'var(--color-text)', fontWeight: 600, fontSize: '0.9rem' }}>
              Money Talks
            </span>
          </div>

          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-muted)',
              fontSize: '0.85rem',
              textAlign: 'center',
              padding: '2rem',
            }}
          >
            Chat coming soon — ask anything about your balance, earnings, or what the agent&apos;s been up to.
          </div>
        </aside>
      </div>
    </div>
  );
}
