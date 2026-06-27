'use client';

import { useState, useEffect, useCallback } from 'react';

interface Contact { label: string; address: string; createdAt: string; }

const SUI_RE = /^0x[0-9a-fA-F]{64}$/;
const short = (addr: string) => `${addr.slice(0, 8)}…${addr.slice(-6)}`;

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      title={address}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        color: copied ? 'var(--color-savings)' : 'var(--color-muted)',
        fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
        transition: 'color 0.15s',
      }}
    >
      {copied ? '✓ copied' : short(address)}
    </button>
  );
}

export function ContactsPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [adding, setAdding] = useState(false);
  const [apiError, setApiError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/contacts');
    if (res.ok) setContacts(await res.json());
  }, []);

  useEffect(() => { void load(); }, [load]);

  const addressError = address.trim() && !SUI_RE.test(address.trim())
    ? 'Must be 0x followed by 64 hex characters'
    : '';
  const canAdd = !!label.trim() && SUI_RE.test(address.trim()) && !adding;

  const handleAdd = async () => {
    setApiError('');
    setAdding(true);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), address: address.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setApiError(data.error ?? 'Failed to add contact');
      } else {
        setLabel('');
        setAddress('');
        await load();
      }
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (lbl: string) => {
    await fetch('/api/contacts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: lbl }),
    });
    await load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Contact list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
        {contacts.length === 0 ? (
          <div style={{ color: 'var(--color-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '3rem 1rem', lineHeight: 1.7 }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>📋</div>
            <div>No contacts yet.</div>
            <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--color-muted-2)' }}>
              Add one below and say "send mom $10".
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {contacts.map((c) => (
              <div
                key={c.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.625rem 0.875rem',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '0.75rem',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-text)' }}>
                    {c.label}
                  </div>
                  <CopyAddress address={c.address} />
                </div>
                <button
                  onClick={() => handleRemove(c.label)}
                  title="Remove contact"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-muted)',
                    fontSize: '1rem',
                    padding: '0.25rem',
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(239,68,68,0.8)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-muted)')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add contact form */}
      <div style={{
        padding: '0.75rem 1rem 1rem',
        borderTop: '1px solid var(--color-border)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Add contact
        </div>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name (e.g. mom)"
          style={inputStyle}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(16,185,129,0.45)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.18)')}
        />
        <div>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x… Sui address"
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(16,185,129,0.45)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.18)')}
          />
          {addressError && (
            <div style={{ color: 'rgba(252,165,165,0.9)', fontSize: '0.72rem', marginTop: '0.25rem', paddingLeft: '0.25rem' }}>
              {addressError}
            </div>
          )}
        </div>
        {apiError && (
          <div style={{ color: 'rgba(252,165,165,0.9)', fontSize: '0.78rem' }}>{apiError}</div>
        )}
        <button
          onClick={handleAdd}
          disabled={!canAdd}
          style={{
            background: canAdd ? 'var(--color-savings)' : 'rgba(255,255,255,0.06)',
            color: canAdd ? '#0a0f1e' : 'var(--color-muted)',
            border: 'none',
            borderRadius: '0.625rem',
            padding: '0.5rem',
            fontSize: '0.85rem',
            fontWeight: 700,
            cursor: canAdd ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {adding ? 'Adding…' : 'Add contact'}
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(148,163,184,0.18)',
  borderRadius: '0.625rem',
  padding: '0.5rem 0.75rem',
  color: 'var(--color-text)',
  fontSize: '0.875rem',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
};
