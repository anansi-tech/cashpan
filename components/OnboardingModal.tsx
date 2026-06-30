'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'cashpan_onboarding_done';

export function OnboardingModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '1.25rem',
          padding: '2rem 1.75rem',
          maxWidth: '380px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: 'center', fontSize: '2.5rem' }}>🍳</div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-text)', marginBottom: '0.4rem' }}>
            Welcome to CashPan
          </div>
          <div style={{ color: 'var(--color-muted)', fontSize: '0.875rem', lineHeight: 1.65 }}>
            Your money lives in two pockets.
          </div>
        </div>

        {/* Two pockets explainer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{
            background: 'var(--color-liquid-dim)',
            border: '1px solid rgba(245,158,11,0.2)',
            borderRadius: '0.75rem',
            padding: '0.875rem 1rem',
            display: 'flex', gap: '0.875rem', alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>💸</span>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--color-liquid)', fontSize: '0.9rem', marginBottom: '0.2rem' }}>
                Spend
              </div>
              <div style={{ color: 'var(--color-muted)', fontSize: '0.82rem', lineHeight: 1.5 }}>
                Ready to use right now. Send money, withdraw, top up anytime.
              </div>
            </div>
          </div>

          <div style={{
            background: 'var(--color-savings-dim)',
            border: '1px solid rgba(16,185,129,0.2)',
            borderRadius: '0.75rem',
            padding: '0.875rem 1rem',
            display: 'flex', gap: '0.875rem', alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>🌱</span>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--color-savings)', fontSize: '0.9rem', marginBottom: '0.2rem' }}>
                Save
              </div>
              <div style={{ color: 'var(--color-muted)', fontSize: '0.82rem', lineHeight: 1.5 }}>
                Tucked away and growing. Move money here to earn yield.
              </div>
            </div>
          </div>
        </div>

        {/* How to start */}
        <div style={{ color: 'var(--color-muted)', fontSize: '0.82rem', lineHeight: 1.65, textAlign: 'center' }}>
          To get started, tap <strong style={{ color: 'var(--color-text)' }}>Receive</strong> to add money,
          then just tell the chat what you want to do.
        </div>

        <button
          onClick={dismiss}
          style={{
            background: 'var(--color-savings)', color: '#0a0f1e',
            border: 'none', borderRadius: '0.75rem',
            padding: '0.875rem', fontSize: '0.95rem', fontWeight: 700,
            cursor: 'pointer', minHeight: '48px',
          }}
        >
          Got it — let's go
        </button>
      </div>
    </div>
  );
}
