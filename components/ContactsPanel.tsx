'use client';

import { useState } from 'react';
import { useVaultData } from './VaultDataProvider';
import type { Contact } from './VaultDataProvider';

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

function SkeletonRow() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.75rem',
      padding: '0.625rem 0.875rem',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid var(--color-border)',
      borderRadius: '0.75rem',
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <div style={{ width: '4rem', height: '0.75rem', borderRadius: '0.25rem', background: 'rgba(255,255,255,0.07)', animation: 'cashpan-pulse 1.4s ease-in-out infinite' }} />
        <div style={{ width: '7rem', height: '0.6rem', borderRadius: '0.25rem', background: 'rgba(255,255,255,0.04)', animation: 'cashpan-pulse 1.4s ease-in-out 0.2s infinite' }} />
      </div>
    </div>
  );
}

export function ContactsPanel() {
  const { contacts, isLoading, refresh } = useVaultData();
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [adding, setAdding] = useState(false);
  const [apiError, setApiError] = useState('');

  // Edit state
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const addressError = address.trim() && !SUI_RE.test(address.trim())
    ? 'Must be 0x followed by 64 hex characters'
    : '';
  const canAdd = !!label.trim() && SUI_RE.test(address.trim()) && !adding;

  const startEdit = (c: Contact) => {
    setEditing(c.label);
    setEditLabel(c.label);
    setEditAddress(c.address);
    setEditError('');
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditError('');
  };

  const handleEdit = async (oldLabel: string) => {
    setEditSaving(true);
    setEditError('');
    try {
      const res = await fetch('/api/contacts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldLabel, label: editLabel.trim(), address: editAddress.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setEditError(data.error ?? 'Failed to update contact');
      } else {
        setEditing(null);
        refresh();
      }
    } catch {
      setEditError('Network issue. Please try again.');
    } finally {
      setEditSaving(false);
    }
  };

  const editAddressError = editAddress.trim() && !SUI_RE.test(editAddress.trim())
    ? 'Must be 0x + 64 hex chars'
    : '';
  const canSaveEdit = !!editLabel.trim() && SUI_RE.test(editAddress.trim()) && !editSaving;

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
        refresh();
      }
    } catch {
      setApiError('Network issue. Please try again.');
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
    refresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Contact list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : contacts.length === 0 ? (
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
                  padding: '0.625rem 0.875rem',
                  background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${editing === c.label ? 'rgba(16,185,129,0.3)' : 'var(--color-border)'}`,
                  borderRadius: '0.75rem',
                  transition: 'border-color 0.15s',
                }}
              >
                {editing === c.label ? (
                  /* Inline edit form */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <input
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Name"
                      style={inputStyle}
                      onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(16,185,129,0.45)')}
                      onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.18)')}
                    />
                    <div>
                      <input
                        value={editAddress}
                        onChange={(e) => setEditAddress(e.target.value)}
                        placeholder="0x… Sui address"
                        style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}
                        onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(16,185,129,0.45)')}
                        onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(148,163,184,0.18)')}
                      />
                      {editAddressError && (
                        <div style={{ color: 'rgba(252,165,165,0.9)', fontSize: '0.7rem', marginTop: '0.2rem', paddingLeft: '0.25rem' }}>
                          {editAddressError}
                        </div>
                      )}
                    </div>
                    {editError && (
                      <div style={{ color: 'rgba(252,165,165,0.9)', fontSize: '0.75rem' }}>{editError}</div>
                    )}
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button
                        onClick={() => handleEdit(c.label)}
                        disabled={!canSaveEdit}
                        style={{
                          flex: 1,
                          background: canSaveEdit ? 'var(--color-savings)' : 'rgba(255,255,255,0.06)',
                          color: canSaveEdit ? '#0a0f1e' : 'var(--color-muted)',
                          border: 'none', borderRadius: '0.5rem',
                          padding: '0.35rem', fontSize: '0.8rem', fontWeight: 700,
                          cursor: canSaveEdit ? 'pointer' : 'not-allowed',
                        }}
                      >
                        {editSaving ? '…' : 'Save'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        style={{
                          background: 'transparent',
                          border: '1px solid rgba(148,163,184,0.2)',
                          color: 'var(--color-muted)',
                          borderRadius: '0.5rem',
                          padding: '0.35rem 0.65rem',
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Normal row */
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-text)' }}>
                        {c.label}
                      </div>
                      <CopyAddress address={c.address} />
                    </div>
                    <button
                      onClick={() => startEdit(c)}
                      title="Edit contact"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--color-muted)', fontSize: '0.85rem',
                        padding: '0.25rem', lineHeight: 1, flexShrink: 0,
                        minWidth: '28px', minHeight: '28px',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-muted)')}
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleRemove(c.label)}
                      title="Remove contact"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--color-muted)', fontSize: '1rem',
                        padding: '0.25rem', lineHeight: 1, flexShrink: 0,
                        minWidth: '28px', minHeight: '28px',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(239,68,68,0.8)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-muted)')}
                    >
                      ✕
                    </button>
                  </div>
                )}
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
            border: 'none', borderRadius: '0.625rem',
            padding: '0.5rem', fontSize: '0.85rem', fontWeight: 700,
            cursor: canAdd ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s, color 0.15s',
            minHeight: '44px',
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
