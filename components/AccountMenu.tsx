'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { useVaultData } from './VaultDataProvider';

const numInputStyle: React.CSSProperties = {
  width: '4rem',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(148,163,184,0.18)',
  borderRadius: '0.4rem',
  padding: '0.25rem 0.4rem',
  color: 'var(--color-text)',
  fontSize: '0.8rem',
  outline: 'none',
  fontFamily: 'var(--font-mono)',
  textAlign: 'right',
};

const COIN_DEC = parseInt(process.env.NEXT_PUBLIC_COIN_DECIMALS ?? '6', 10);
const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'USD';

// ── Vault ID copy row (Developer details) ────────────────────────────────────

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
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--color-border)', borderRadius: '0.5rem',
        padding: '0.35rem 0.625rem', cursor: 'pointer',
        color: copied ? 'var(--color-savings)' : 'var(--color-text)',
        fontSize: '0.72rem', fontFamily: 'var(--font-mono)',
        transition: 'color 0.15s', textAlign: 'left', gap: '0.5rem',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {display}
      </span>
      <span style={{ flexShrink: 0, opacity: 0.6 }}>{copied ? '✓' : '⎘'}</span>
    </button>
  );
}

// ── Wallet block — address + outside-CashPan balance in one row ──────────────

function WalletBlock({ address }: { address: string }) {
  const { walletBalance } = useVaultData();
  const [copied, setCopied] = useState(false);

  const balance = (Number(walletBalance ?? '0') / 10 ** COIN_DEC).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const copy = () => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
        Wallet
      </div>
      <button
        onClick={copy}
        title={address}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--color-border)', borderRadius: '0.5rem',
          padding: '0.5rem 0.625rem', cursor: 'pointer', textAlign: 'left', gap: '0.5rem',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {`${address.slice(0, 10)}…${address.slice(-8)}`}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--color-muted)', marginTop: '0.1rem' }}>
            ${balance} outside CashPan
          </div>
        </div>
        <span style={{ color: copied ? 'var(--color-savings)' : 'var(--color-muted)', flexShrink: 0, fontSize: '0.85rem', transition: 'color 0.15s' }}>
          {copied ? '✓' : '⎘'}
        </span>
      </button>
    </div>
  );
}

// ── Auto-save rule — sentence with inline-editable chips ─────────────────────

function AutoSaveRule() {
  const { settings, refresh } = useVaultData();
  const [bufferEdit, setBufferEdit] = useState<string | null>(null);
  const [bandEdit, setBandEdit] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSaved = () => {
    setSavedMsg(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedMsg(false), 2000);
  };

  useEffect(() => () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); }, []);

  const commitBuffer = async (val: string) => {
    const band = bandEdit ?? settings.band;
    setBufferEdit(null);
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buffer: val, band }),
    });
    showSaved();
    refresh();
  };

  const commitBand = async (val: string) => {
    const buffer = bufferEdit ?? settings.buffer;
    setBandEdit(null);
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buffer, band: val }),
    });
    showSaved();
    refresh();
  };

  const chipStyle: React.CSSProperties = {
    display: 'inline',
    fontFamily: 'var(--font-mono)', fontWeight: 700,
    background: 'rgba(255,255,255,0.06)', borderRadius: '5px',
    padding: '1px 6px', cursor: 'text', color: 'var(--color-text)',
  };

  return (
    <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
        <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Auto-save rule
        </div>
        {savedMsg && <span style={{ fontSize: '0.72rem', color: 'var(--color-savings)' }}>✓ Saved</span>}
      </div>
      <div style={{ fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.6 }}>
        {'Keep '}
        {bufferEdit !== null ? (
          <input
            type="number" min="0" step="0.01" autoFocus
            value={bufferEdit}
            onChange={(e) => setBufferEdit(e.target.value)}
            onBlur={() => { void commitBuffer(bufferEdit); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { void commitBuffer(bufferEdit); }
              if (e.key === 'Escape') setBufferEdit(null);
            }}
            style={numInputStyle}
          />
        ) : (
          <span style={chipStyle} onClick={() => setBufferEdit(bufferEdit ?? settings.buffer)}>
            {bufferEdit ?? settings.buffer}
          </span>
        )}
        {' in Spend, sweep the rest to Save once it grows by '}
        {bandEdit !== null ? (
          <input
            type="number" min="0" step="0.01" autoFocus
            value={bandEdit}
            onChange={(e) => setBandEdit(e.target.value)}
            onBlur={() => { void commitBand(bandEdit); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { void commitBand(bandEdit); }
              if (e.key === 'Escape') setBandEdit(null);
            }}
            style={numInputStyle}
          />
        ) : (
          <span style={chipStyle} onClick={() => setBandEdit(bandEdit ?? settings.band)}>
            {bandEdit ?? settings.band}
          </span>
        )}
        {'.'}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AccountMenu({ address, vaultId }: { address: string; vaultId: string }) {
  const { signOut, user } = useAuth();
  const { balances } = useVaultData();
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // TODO: if name/email are not in session, show short address as title
  const displayName = user?.name ?? `${address.slice(0, 8)}…${address.slice(-4)}`;
  const displaySub  = user?.email ? `${user.email} · Google` : null;
  const initial     = user?.name ? user.name.charAt(0).toUpperCase() : address.slice(2, 3).toUpperCase();

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
          {/* 1. Identity header */}
          <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {user?.picture && !imgErr ? (
              <img
                src={user.picture}
                alt=""
                onError={() => setImgErr(true)}
                style={{ width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0, objectFit: 'cover', border: '1px solid rgba(16,185,129,0.3)' }}
              />
            ) : (
              <div style={{
                width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0,
                background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--color-savings-bright)', fontWeight: 700, fontSize: '1.05rem',
              }}>
                {initial}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </div>
              {displaySub && (
                <div style={{ fontSize: '0.72rem', color: 'var(--color-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displaySub}
                </div>
              )}
            </div>
          </div>

          {/* 2. Wallet block — address shown exactly once */}
          <WalletBlock address={address} />

          {/* 3. Auto-save rule */}
          <AutoSaveRule />

          {/* 4. Developer details */}
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
                {balances?.currentEpoch && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <span style={{ fontSize: '0.68rem', color: 'var(--color-muted-2)' }}>Epoch</span>
                    <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--color-text)', fontWeight: 600 }}>{balances.currentEpoch}</span>
                  </div>
                )}
                <div style={{ fontSize: '0.68rem', color: 'var(--color-muted-2)' }}>Vault ID</div>
                <CopyRow value={vaultId} />
              </div>
            )}
          </div>

          {/* 5. Sign out */}
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
