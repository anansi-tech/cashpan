'use client';

import { useState } from 'react';
import { ChatPanel } from './ChatPanel';
import { ContactsPanel } from './ContactsPanel';
import type { VaultTxContext } from '@/lib/vault-tx';

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
      }}
    >
      {label}
    </button>
  );
}

export function AsidePanel({ vaultCtx, onRefresh }: { vaultCtx: VaultTxContext; onRefresh?: () => void }) {
  const [tab, setTab] = useState<'chat' | 'contacts'>('chat');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab header */}
      <div style={{
        padding: '0.875rem 1.25rem 0',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        gap: '1.25rem',
        flexShrink: 0,
      }}>
        <Tab label="💬 Money Talks" active={tab === 'chat'} onClick={() => setTab('chat')} />
        <Tab label="👤 Contacts" active={tab === 'contacts'} onClick={() => setTab('contacts')} />
      </div>

      {/* Panel body — both mounted, hidden/shown to preserve chat state */}
      <div style={{ flex: 1, overflow: 'hidden', display: tab === 'chat' ? 'flex' : 'none', flexDirection: 'column' }}>
        <ChatPanel vaultCtx={vaultCtx} onRefresh={onRefresh} />
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: tab === 'contacts' ? 'flex' : 'none', flexDirection: 'column' }}>
        <ContactsPanel />
      </div>
    </div>
  );
}
