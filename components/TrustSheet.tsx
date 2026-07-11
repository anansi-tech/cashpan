'use client';

import { useEffect } from 'react';

/**
 * The "Is this safe?" sheet. One component, three entry points (sign-in link,
 * Add-money panel, Profile menu). Copy is the deliverable — fifth-grade
 * reading level, no crypto jargon, and the not-FDIC-insured line stays.
 *
 * aprBps / vaultId are optional: the sign-in page runs before a vault or APR
 * exists, so the sheet degrades honestly instead of hardcoding a number.
 */
export function TrustSheet({
  open,
  onClose,
  aprBps,
  vaultId,
}: {
  open: boolean;
  onClose: () => void;
  aprBps?: string;
  vaultId?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const aprPct = aprBps && Number(aprBps) > 0 ? (Number(aprBps) / 100).toFixed(1) : null;

  return (
    <>
      {/* data-trust-sheet: AccountMenu's click-outside handler ignores these
          nodes so opening the sheet from the dropdown doesn't unmount it. */}
      <div
        data-trust-sheet=""
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 300 }}
      />
      <div
        data-trust-sheet=""
        role="dialog"
        aria-modal="true"
        aria-label="How CashPan keeps your money safe"
        style={{
          position: 'fixed', zIndex: 301,
          left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(92vw, 430px)', maxHeight: '85dvh', overflowY: 'auto',
          background: '#0f172a', border: '1px solid var(--color-border)',
          borderRadius: '1rem', padding: '1.5rem 1.375rem',
          display: 'flex', flexDirection: 'column', gap: '1.125rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Is my money safe here?
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--color-muted)', fontSize: '1.2rem', cursor: 'pointer', minWidth: '44px', minHeight: '44px' }}
          >
            ✕
          </button>
        </div>

        <Section title="Your money stays yours.">
          CashPan never holds your money. When you sign in with Google, your own wallet
          is created on the Sui network — only you can move money out of it. Every
          transfer requires your approval. We can&apos;t touch it, freeze it, or lose it.
        </Section>

        <Section title="Where the growth comes from.">
          Savings are lent through Suilend, an on-chain lending market, in USDC — a
          digital dollar backed 1:1 by Circle. Borrowers pay interest; you earn it.
          The rate is variable{aprPct ? ` (currently ~${aprPct}%)` : ''} and shown
          live in the app — never a promise.
        </Section>

        <Section title="You can always leave.">
          Withdraw to your own wallet anytime, no permission needed — or cash out
          to your bank right from the app. Everything is public on the Sui blockchain.
          {vaultId && (
            <>
              {' '}
              <a
                href={`https://suivision.xyz/object/${vaultId}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--color-savings)', fontWeight: 600 }}
              >
                View my account on-chain ↗
              </a>
            </>
          )}
        </Section>

        <Section title="What this is not.">
          CashPan is not a bank and deposits are not FDIC-insured. Smart-contract and
          market risks exist. Don&apos;t save what you can&apos;t afford to lock up
          while you learn to trust it.
        </Section>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)', marginBottom: '0.3rem' }}>
        {title}
      </div>
      <div style={{ fontSize: '0.84rem', color: 'var(--color-muted)', lineHeight: 1.65 }}>
        {children}
      </div>
    </div>
  );
}
