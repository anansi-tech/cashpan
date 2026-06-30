'use client';

import { useState, useEffect } from 'react';
import { useVaultData } from './VaultDataProvider';

export function SettingsPanel() {
  const { settings, refresh } = useVaultData();
  const [buffer, setBuffer] = useState(settings.buffer);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setBuffer(settings.buffer); }, [settings.buffer]);

  const isDirty = buffer !== settings.buffer;

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buffer }),
      });
      setSaved(true);
      refresh();
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        borderTop: '1px solid var(--color-border)',
        paddingTop: '1rem',
        marginTop: '0.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ color: 'var(--color-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
        Keep at least
      </span>
      <input
        type="number"
        min="0"
        step="1"
        value={buffer}
        onChange={(e) => setBuffer(e.target.value)}
        style={{
          width: '4.5rem',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(148,163,184,0.18)',
          borderRadius: '0.5rem',
          padding: '0.3rem 0.5rem',
          color: 'var(--color-text)',
          fontSize: '0.875rem',
          outline: 'none',
          fontFamily: 'var(--font-mono)',
          textAlign: 'right',
        }}
      />
      <span style={{ color: 'var(--color-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
        in Spend
      </span>
      <button
        onClick={handleSave}
        disabled={!isDirty || saving}
        style={{
          background: saved ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${saved ? 'rgba(16,185,129,0.3)' : 'rgba(148,163,184,0.18)'}`,
          color: saved ? 'var(--color-savings)' : 'var(--color-muted)',
          borderRadius: '0.5rem',
          padding: '0.3rem 0.65rem',
          fontSize: '0.78rem',
          cursor: !isDirty || saving ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s',
          opacity: !isDirty || saving ? 0.5 : 1,
        }}
      >
        {saved ? '✓ Saved' : saving ? '…' : 'Save'}
      </button>
    </div>
  );
}
