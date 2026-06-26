'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { handleCallback } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';

export default function CallbackPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    handleCallback()
      .then((session) => {
        setSession(session);
        router.replace('/');
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Authentication failed');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          fontFamily: 'var(--font-mono)',
          background: 'var(--color-bg)',
        }}
      >
        <p style={{ color: '#ef4444', fontSize: '0.875rem' }}>{error}</p>
        <a href="/" style={{ color: 'var(--color-savings)', fontSize: '0.8rem' }}>
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg)',
        color: 'var(--color-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.875rem',
      }}
    >
      Completing sign in…
    </div>
  );
}
