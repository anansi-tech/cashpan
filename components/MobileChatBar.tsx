'use client';

import { ChatPanel } from './ChatPanel';
import type { VaultTxContext } from '@/lib/vault-tx';

const NAV_H = 52; // matches BottomNav minHeight

export function MobileChatBar({
  open,
  onToggle,
  vaultCtx,
}: {
  open: boolean;
  onToggle: () => void;
  vaultCtx: VaultTxContext;
}) {
  return (
    <>
      {/* Expanded panel — always mounted so ChatPanel state (messages) survives open/close */}
      <div
        style={{
          position: 'fixed',
          bottom: NAV_H,
          left: 0,
          right: 0,
          height: open ? `calc(100dvh - 3.5rem - ${NAV_H}px)` : 0,
          overflow: 'hidden',
          background: 'var(--color-surface)',
          borderTop: open ? '1px solid var(--color-border)' : 'none',
          display: 'flex',
          flexDirection: 'column',
          transition: 'height 0.22s ease',
          zIndex: 20,
        }}
      >
        {/* Header — only rendered when open to avoid focus traps */}
        <div
          style={{
            display: open ? 'flex' : 'none',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.625rem 1rem',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>
            💬 Money Talks
          </span>
          <button
            onClick={onToggle}
            style={{
              background: 'none', border: 'none',
              color: 'var(--color-muted)', cursor: 'pointer',
              fontSize: '1.1rem', minWidth: '44px', minHeight: '44px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Close chat"
          >
            ↓
          </button>
        </div>

        {/* ChatPanel — always in DOM; hidden by height:0 when closed */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', visibility: open ? 'visible' : 'hidden' }}>
          <ChatPanel vaultCtx={vaultCtx} />
        </div>
      </div>

      {/* Collapsed bar — tap to open */}
      {!open && (
        <button
          onClick={onToggle}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.625rem 1rem',
            background: 'rgba(255,255,255,0.02)',
            border: 'none',
            borderTop: '1px solid var(--color-border)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <span style={{ flex: 1, color: 'var(--color-muted)', fontSize: '0.875rem', textAlign: 'left' }}>
            Ask CashPan…
          </span>
          <span style={{ color: 'var(--color-savings)', fontSize: '0.875rem', fontWeight: 600 }}>↑</span>
        </button>
      )}
    </>
  );
}
