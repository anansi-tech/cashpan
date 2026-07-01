'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from './AuthProvider';

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const display = `${value.slice(0, 10)}…${value.slice(-8)}`;
  return (
    <button
      onClick={copy}
      title={value}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--color-border)',
        borderRadius: '0.5rem',
        padding: '0.35rem 0.625rem',
        cursor: 'pointer',
        color: copied ? 'var(--color-savings)' : 'var(--color-text)',
        fontSize: '0.72rem',
        fontFamily: 'var(--font-mono)',
        transition: 'color 0.15s',
        textAlign: 'left',
        gap: '0.5rem',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {display}
      </span>
      <span style={{ flexShrink: 0, opacity: 0.6 }}>{copied ? '✓' : '⎘'}</span>
    </button>
  );
}

export function AccountMenu({ address, vaultId }: { address: string; vaultId: string }) {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        title="Account"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '32px', height: '32px', borderRadius: '50%',
          background: open ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${open ? 'rgba(16,185,129,0.3)' : 'var(--color-border)'}`,
          cursor: 'pointer', color: 'var(--color-muted)',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <circle cx="7.5" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M2 13c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 0.5rem)', right: 0,
          width: '280px', background: '#0f172a',
          border: '1px solid var(--color-border)', borderRadius: '0.875rem',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)', zIndex: 200, overflow: 'hidden',
        }}>
          {/* Wallet address */}
          <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
              Wallet
            </div>
            <CopyRow value={address} />
          </div>

          {/* Developer details — collapsed */}
          <div style={{ borderBottom: '1px solid var(--color-border)' }}>
            <button
              onClick={() => setShowDetails(!showDetails)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', padding: '0.5rem 1rem',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--color-muted)', fontSize: '0.72rem',
              }}
            >
              <span>Developer details</span>
              <span style={{ opacity: 0.5 }}>{showDetails ? '▲' : '▼'}</span>
            </button>
            {showDetails && (
              <div style={{ padding: '0 1rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--color-muted-2)' }}>Vault ID</div>
                <CopyRow value={vaultId} />
              </div>
            )}
          </div>

          {/* Sign out */}
          <button
            onClick={signOut}
            style={{
              width: '100%', padding: '0.75rem 1rem',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(252,165,165,0.8)', fontSize: '0.875rem', textAlign: 'left',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
