'use client';

import { startLogin } from '@/lib/auth';
import { useState } from 'react';

export function SignIn() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setLoading(true);
    setError(null);
    try {
      await startLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed');
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg)',
        gap: '1.5rem',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
        <span style={{ fontSize: '2rem' }}>🍳</span>
        <span
          style={{
            fontSize: '1.6rem',
            fontWeight: 700,
            color: 'var(--color-savings)',
            letterSpacing: '-0.02em',
          }}
        >
          CashPan
        </span>
      </div>

      <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem', margin: 0 }}>
        Your money, working.
      </p>

      <button
        onClick={handleSignIn}
        disabled={loading}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          padding: '0.625rem 1.25rem',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '0.5rem',
          color: 'var(--color-text)',
          cursor: loading ? 'wait' : 'pointer',
          fontSize: '0.875rem',
          fontFamily: 'var(--font-mono)',
          opacity: loading ? 0.6 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
          <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
        </svg>
        {loading ? 'Redirecting…' : 'Sign in with Google'}
      </button>

      {error && (
        <p style={{ color: '#ef4444', fontSize: '0.8rem', margin: 0 }}>{error}</p>
      )}
    </div>
  );
}
