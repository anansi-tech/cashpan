'use client';

import { useEffect, useState } from 'react';
import { useDeposit } from '@/lib/use-deposit';
import type { VaultTxContext } from '@/lib/vault-tx';
import { formatMoney } from '@/lib/format';

const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'USD';

const baseToHuman = (base: bigint): string => formatMoney(base);

function CopyChip({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={copy}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)',
        borderRadius: '0.625rem', padding: '0.6rem 1rem',
        color: copied ? 'var(--color-savings)' : 'var(--color-text)',
        fontSize: '0.82rem', fontFamily: 'var(--font-mono)',
        cursor: 'pointer', transition: 'color 0.15s',
        wordBreak: 'break-all', textAlign: 'left', width: '100%',
      }}
    >
      <span style={{ flexShrink: 0 }}>{copied ? '✓' : '⎘'}</span>
      <span>{copied ? `${label} copied!` : value}</span>
    </button>
  );
}

export function ReceivePanel({ vaultCtx }: { vaultCtx: VaultTxContext }) {
  const { totalOwned, depositedAmount, state: depositState, error: depositError, deposit: handleDeposit } = useDeposit(vaultCtx);
  const address = vaultCtx.userAddress ?? '';
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    import('qrcode')
      .then((mod) => {
        const QRCode = mod.default ?? mod;
        return (QRCode as { toDataURL: (text: string, opts: object) => Promise<string> })
          .toDataURL(address, { width: 200, margin: 2, color: { dark: '#f1f5f9', light: '#0f172a' } });
      })
      .then(setQrDataUrl)
      .catch(console.error);
  }, [address]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '1.5rem 1.25rem', gap: '1.5rem' }}>

      {/* Address + QR */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
        {qrDataUrl ? (
          <img src={qrDataUrl} alt="Your CashPan address QR code" width={180} height={180}
            style={{ borderRadius: '0.75rem', border: '1px solid var(--color-border)' }} />
        ) : (
          <div style={{ width: 180, height: 180, background: 'rgba(255,255,255,0.04)', borderRadius: '0.75rem', border: '1px solid var(--color-border)' }} />
        )}

        <div style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--color-text)', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Your address</div>
          <div style={{ color: 'var(--color-muted)', fontSize: '0.78rem', lineHeight: 1.5 }}>
            Share this to receive {COIN_SYM}. Coins sent here land in your wallet.
          </div>
        </div>

        {address && <CopyChip value={address} label="Address" />}
      </div>

      <div style={{ height: '1px', background: 'var(--color-border)' }} />

      {/* Add to CashPan */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-text)' }}>Add to CashPan</div>
        <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)', lineHeight: 1.55 }}>
          If you&apos;ve received {COIN_SYM} to your address, tap below to move it into your Spend pocket.
        </div>

        {totalOwned === 0n && depositState !== 'success' && (
          <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)', fontStyle: 'italic' }}>
            No {COIN_SYM} found in your wallet yet.
          </div>
        )}

        {totalOwned > 0n && depositState !== 'success' && (
          <>
            <div style={{ fontSize: '0.82rem', color: 'var(--color-savings)', fontWeight: 600 }}>
              {baseToHuman(totalOwned)} {COIN_SYM} available in your wallet
            </div>
            <button
              onClick={handleDeposit}
              disabled={depositState === 'depositing'}
              style={{
                background: depositState === 'depositing' ? 'rgba(16,185,129,0.3)' : 'var(--color-savings)',
                color: '#0a0f1e', border: 'none', borderRadius: '0.625rem',
                padding: '0.75rem', fontSize: '0.9rem', fontWeight: 700,
                cursor: depositState === 'depositing' ? 'not-allowed' : 'pointer',
                minHeight: '44px',
              }}
            >
              {depositState === 'depositing' ? 'Adding to CashPan…' : `Add ${baseToHuman(totalOwned)} ${COIN_SYM} to Spend`}
            </button>
            {depositState === 'error' && (
              <div style={{ fontSize: '0.82rem', color: 'rgba(252,165,165,0.9)' }}>{depositError}</div>
            )}
          </>
        )}

        {depositState === 'success' && (
          <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '0.625rem', padding: '0.75rem 1rem' }}>
            <div style={{ color: 'var(--color-savings)', fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.25rem' }}>
              ✓ Added ${baseToHuman(depositedAmount)} to your Spend pocket
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
