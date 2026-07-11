'use client';

import { useState, useEffect } from 'react';
import { LiveDashboard } from './LiveDashboard';
import { ActivityFeed } from './ActivityFeed';
import { ChatPanel } from './ChatPanel';
import { ProposalBanner } from './ProposalBanner';
import { SendSheet } from './SendSheet';
import { ProfileContent } from './AccountMenu';
import { ReceivePanel } from './ReceivePanel';
import { BottomNav, type MobileTab } from './BottomNav';
import { MobileChatBar } from './MobileChatBar';
import type { VaultTxContext } from '@/lib/vault-tx';

export function AppShell({ vaultCtx }: { vaultCtx: VaultTxContext }) {
  const [mobileTab, setMobileTab] = useState<MobileTab>('home');
  const [chatOpen, setChatOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

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

  useEffect(() => {
    if (!receiveOpen && !sendOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setReceiveOpen(false); setSendOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [receiveOpen, sendOpen]);

  const handleTabChange = (tab: MobileTab) => {
    if (tab === 'send') { setSendOpen(true); return; }
    setMobileTab(tab);
    setReceiveOpen(false);
  };

  return (
    <>
      {/* ── Overlays — scrim + right-anchored panel on desktop, full-screen on mobile ── */}
      {receiveOpen && (
        <>
          <div className="overlay-scrim" onClick={() => setReceiveOpen(false)} />
          <div className="overlay-panel">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text)' }}>Receive</span>
              <button onClick={() => setReceiveOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', fontSize: '1.25rem', cursor: 'pointer', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <ReceivePanel vaultCtx={vaultCtx} />
            </div>
          </div>
        </>
      )}

      {sendOpen && (
        <>
          <div className="overlay-scrim" onClick={() => setSendOpen(false)} />
          <div className="overlay-panel">
            <SendSheet vaultCtx={vaultCtx} onClose={() => setSendOpen(false)} />
          </div>
        </>
      )}

      {/* ── Desktop layout ≥1024px ────────────────────────────────────────────── */}
      <div className="shell-desktop">

        {/* Left rail: money */}
        <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '1.75rem 1.5rem', gap: '1.25rem', borderRight: '1px solid var(--color-border)' }}>
          <ProposalBanner vaultCtx={vaultCtx} />
          <LiveDashboard />
        </div>

        {/* Center: chat hero */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {/* Panel header — desktop only */}
          <div style={{ padding: '1rem 2rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.625rem', flexShrink: 0 }}>
            <span style={{ fontSize: '0.9375rem' }}>💬</span>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>Money Talks</span>
          </div>
          <ChatPanel vaultCtx={vaultCtx} />
        </div>

        {/* Right rail: activity */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderLeft: '1px solid var(--color-border)' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '1.75rem 1.5rem' }}>
            <ActivityFeed flush />
          </div>
        </div>
      </div>

      {/* ── Mobile layout <1024px ─────────────────────────────────────────────── */}
      <div className="shell-mobile">
        <div className="mobile-content">
          {/* Home */}
          <div style={{ display: mobileTab === 'home' ? 'flex' : 'none', flexDirection: 'column', gap: 0, padding: '1rem', overflowY: 'auto', flex: 1 }}>
              <ProposalBanner vaultCtx={vaultCtx} />
            <LiveDashboard />
          </div>

          {/* Activity */}
          <div style={{ display: mobileTab === 'activity' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflowY: 'auto', padding: '1rem' }}>
            <ActivityFeed />
          </div>

          {/* Profile */}
          <div style={{ display: mobileTab === 'profile' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
            <ProfileContent address={vaultCtx.userAddress} vaultId={vaultCtx.vaultId} />
          </div>
        </div>

        <MobileChatBar open={chatOpen} onToggle={() => setChatOpen(!chatOpen)} vaultCtx={vaultCtx} />
        <BottomNav active={mobileTab} onChange={handleTabChange} />
      </div>
    </>
  );
}
