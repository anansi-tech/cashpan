'use client';

import { useState, useEffect } from 'react';
import { ChatPanel } from './ChatPanel';
import { ContactsPanel } from './ContactsPanel';
import { ReceivePanel } from './ReceivePanel';
import type { VaultTxContext } from '@/lib/vault-tx';

type TabId = 'chat' | 'contacts' | 'receive';

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        borderBottom: `2px solid ${active ? 'var(--color-savings)' : 'transparent'}`,
        color: active ? 'var(--color-text)' : 'var(--color-muted)',
        fontWeight: active ? 600 : 400,
        fontSize: '0.875rem',
        padding: '0 0 0.5rem',
        cursor: 'pointer',
        transition: 'color 0.15s, border-color 0.15s',
        whiteSpace: 'nowrap',
        minHeight: '44px',
        display: 'flex',
        alignItems: 'flex-start',
      }}
    >
      {label}
    </button>
  );
}

export function AsidePanel({ vaultCtx, onRefresh }: { vaultCtx: VaultTxContext; onRefresh?: () => void }) {
  const [tab, setTab] = useState<TabId>('chat');

  useEffect(() => {
    const onReceive = () => setTab('receive');
    const onSend = () => setTab('contacts');
    const onChat = () => setTab('chat');
    window.addEventListener('cashpan:show-receive', onReceive);
    window.addEventListener('cashpan:show-send', onSend);
    window.addEventListener('cashpan:show-chat', onChat);
    return () => {
      window.removeEventListener('cashpan:show-receive', onReceive);
      window.removeEventListener('cashpan:show-send', onSend);
      window.removeEventListener('cashpan:show-chat', onChat);
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab header */}
      <div style={{
        padding: '0 1.25rem',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        gap: '1.25rem',
        flexShrink: 0,
      }}>
        <Tab label="💬 Money Talks" active={tab === 'chat'} onClick={() => setTab('chat')} />
        <Tab label="📥 Receive" active={tab === 'receive'} onClick={() => setTab('receive')} />
        <Tab label="👤 Contacts" active={tab === 'contacts'} onClick={() => setTab('contacts')} />
      </div>

      {/* Panels — all mounted, visibility toggled so chat state survives tab switches */}
      <div style={{ flex: 1, overflow: 'hidden', display: tab === 'chat' ? 'flex' : 'none', flexDirection: 'column' }}>
        <ChatPanel vaultCtx={vaultCtx} onRefresh={onRefresh} />
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: tab === 'receive' ? 'flex' : 'none', flexDirection: 'column' }}>
        <ReceivePanel vaultCtx={vaultCtx} />
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: tab === 'contacts' ? 'flex' : 'none', flexDirection: 'column' }}>
        <ContactsPanel />
      </div>
    </div>
  );
}
