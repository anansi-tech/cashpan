'use client';

import { useState, useEffect } from 'react';
import { LiveDashboard } from './LiveDashboard';
import { ActivityFeed } from './ActivityFeed';
import { AsidePanel } from './AsidePanel';
import { ProposalBanner } from './ProposalBanner';
import { WalletArrivalStrip } from './WalletArrivalStrip';
import { SendSheet } from './SendSheet';
import { SettingsPanel } from './SettingsPanel';
import { ContactsPanel } from './ContactsPanel';
import { ReceivePanel } from './ReceivePanel';
import { BottomNav, type MobileTab } from './BottomNav';
import { MobileChatBar } from './MobileChatBar';
import type { VaultTxContext } from '@/lib/vault-tx';

export function AppShell({ vaultCtx }: { vaultCtx: VaultTxContext }) {
  const [mobileTab, setMobileTab] = useState<MobileTab>('home');
  const [chatOpen, setChatOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  // Quick-action events from LiveDashboard and other components
  useEffect(() => {
    const onReceive = () => setReceiveOpen(true);
    const onSend = () => setSendOpen(true);
    const onChat = () => setChatOpen(true);
    window.addEventListener('cashpan:show-receive', onReceive);
    window.addEventListener('cashpan:show-send', onSend);
    window.addEventListener('cashpan:show-chat', onChat);
    return () => {
      window.removeEventListener('cashpan:show-receive', onReceive);
      window.removeEventListener('cashpan:show-send', onSend);
      window.removeEventListener('cashpan:show-chat', onChat);
    };
  }, []);

  const handleTabChange = (tab: MobileTab) => {
    if (tab === 'send') { setSendOpen(true); return; }
    setMobileTab(tab);
    setReceiveOpen(false);
  };

  return (
    <>
      {/* ── Desktop layout (hidden on mobile via CSS) ─────────────────────────── */}
      <div className="shell-desktop">
        <main
          style={{
            padding: '1.25rem 1.5rem',
            overflowY: 'auto',
            borderRight: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
          }}
        >
          <WalletArrivalStrip vaultCtx={vaultCtx} />
          <ProposalBanner vaultCtx={vaultCtx} />
          <LiveDashboard />
          <ActivityFeed />
        </main>
        <aside style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <AsidePanel vaultCtx={vaultCtx} />
        </aside>
      </div>

      {/* ── Mobile layout (hidden on desktop via CSS) ─────────────────────────── */}
      <div className="shell-mobile">

        {/* Receive overlay */}
        {receiveOpen && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'var(--color-bg)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text)' }}>Receive</span>
              <button onClick={() => setReceiveOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', fontSize: '1.25rem', cursor: 'pointer', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <ReceivePanel vaultCtx={vaultCtx} />
            </div>
          </div>
        )}

        {/* Send overlay */}
        {sendOpen && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'var(--color-bg)', display: 'flex', flexDirection: 'column' }}>
            <SendSheet vaultCtx={vaultCtx} onClose={() => setSendOpen(false)} />
          </div>
        )}

        {/* Tab content */}
        <div className="mobile-content">
          {/* Home */}
          <div style={{ display: mobileTab === 'home' ? 'flex' : 'none', flexDirection: 'column', gap: '0', padding: '1rem', overflowY: 'auto', flex: 1 }}>
            <WalletArrivalStrip vaultCtx={vaultCtx} />
            <ProposalBanner vaultCtx={vaultCtx} />
            <LiveDashboard />
          </div>

          {/* Activity */}
          <div style={{ display: mobileTab === 'activity' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflowY: 'auto', padding: '1rem' }}>
            <ActivityFeed />
          </div>

          {/* Settings */}
          <div style={{ display: mobileTab === 'settings' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', gap: '1.5rem' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text)', marginBottom: '0.5rem' }}>Agent Settings</div>
              <SettingsPanel />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text)', marginBottom: '0.5rem' }}>Contacts</div>
              <ContactsPanel />
            </div>
          </div>
        </div>

        {/* Persistent chat bar above bottom nav */}
        <MobileChatBar open={chatOpen} onToggle={() => setChatOpen(!chatOpen)} vaultCtx={vaultCtx} />

        <BottomNav active={mobileTab} onChange={handleTabChange} />
      </div>
    </>
  );
}
