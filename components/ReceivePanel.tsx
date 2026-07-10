'use client';

import { useEffect, useState } from 'react';
import { useDeposit } from '@/lib/use-deposit';
import type { VaultTxContext } from '@/lib/vault-tx';
import { formatMoney } from '@/lib/format';
import { openOnramp } from '@/lib/onramp';

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

// ─── Add money (Coinbase Onramp) ──────────────────────────────────────────────

function AddMoneySection() {
  const [amount, setAmount] = useState('');
  const [state, setState] = useState<'idle' | 'opening' | 'error'>('idle');
  const [error, setError] = useState('');

  const handleAddMoney = async () => {
    setState('opening');
    setError('');
    try {
      await openOnramp(amount ? parseFloat(amount) : undefined);
      setState('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the payment flow. Try again.');
      setState('error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.25rem', flex: 1,
          background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)',
          borderRadius: '0.625rem', padding: '0 0.75rem',
        }}>
          <span style={{ color: 'var(--color-muted)', fontSize: '0.9rem' }}>$</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="Amount (optional)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--color-text)', fontSize: '0.9rem', fontFamily: 'var(--font-mono)',
              padding: '0.7rem 0', minWidth: 0,
            }}
          />
        </div>
      </div>

      <button
        onClick={handleAddMoney}
        disabled={state === 'opening'}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
          background: state === 'opening' ? 'rgba(16,185,129,0.3)' : 'var(--color-savings)',
          color: '#0a0f1e', border: 'none', borderRadius: '0.625rem',
          padding: '0.8rem', fontSize: '0.9375rem', fontWeight: 700,
          cursor: state === 'opening' ? 'wait' : 'pointer', minHeight: '48px',
        }}
      >
        💳 {state === 'opening' ? 'Opening…' : 'Add money'}
      </button>

      <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)', textAlign: 'center', lineHeight: 1.5 }}>
        Debit card, bank, or Apple Pay · arrives in minutes · powered by Coinbase
      </div>

      {state === 'error' && (
        <div style={{ fontSize: '0.82rem', color: 'rgba(252,165,165,0.9)' }}>{error}</div>
      )}
    </div>
  );
}

// ─── Receive crypto (QR + address, secondary) ─────────────────────────────────

function ReceiveCryptoSection({ address }: { address: string }) {
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', paddingTop: '0.75rem' }}>
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
  );
}

export function ReceivePanel({ vaultCtx }: { vaultCtx: VaultTxContext }) {
  const { totalOwned, depositedAmount, state: depositState, error: depositError, deposit: handleDeposit } = useDeposit(vaultCtx);
  const address = vaultCtx.userAddress ?? '';
  const [showCrypto, setShowCrypto] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '1.5rem 1.25rem', gap: '1.5rem' }}>

      {/* Primary: Add money via debit card / Apple Pay */}
      <AddMoneySection />

      <div style={{ height: '1px', background: 'var(--color-border)' }} />

      {/* Secondary: receive crypto directly (QR + address behind a toggle) */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <button
          onClick={() => setShowCrypto((v) => !v)}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            color: 'var(--color-muted)', fontSize: '0.82rem', fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '32px',
          }}
        >
          <span>Receive crypto instead</span>
          <span style={{ opacity: 0.6 }}>{showCrypto ? '▲' : '▼'}</span>
        </button>
        {showCrypto && <ReceiveCryptoSection address={address} />}
      </div>

      <div style={{ height: '1px', background: 'var(--color-border)' }} />

      {/* Add to CashPan — moves wallet USDC into the Spend pocket */}
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
