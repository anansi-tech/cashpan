'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSession } from '@/lib/auth';
import { executeTransaction } from '@/lib/execute-zklogin';
import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import type { VaultTxContext } from '@/lib/vault-tx';

const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'USD';
const COIN_DEC = parseInt(process.env.NEXT_PUBLIC_COIN_DECIMALS ?? '6', 10);

function baseToHuman(base: string): string {
  const n = Number(base) / 10 ** COIN_DEC;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

interface OwnedCoin { coinObjectId: string; balance: string; }

async function fetchOwnedCoins(address: string, coinType: string): Promise<OwnedCoin[]> {
  const network = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet') as 'testnet';
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });
  const result = await client.getCoins({ owner: address, coinType });
  return result.data.map((c) => ({ coinObjectId: c.coinObjectId, balance: c.balance }));
}

function buildDepositTx(coins: OwnedCoin[], ctx: VaultTxContext): Transaction {
  const tx = new Transaction();
  if (coins.length > 1) {
    tx.mergeCoins(
      tx.object(coins[0].coinObjectId),
      coins.slice(1).map((c) => tx.object(c.coinObjectId)),
    );
  }
  tx.moveCall({
    target: `${ctx.packageId}::vault::deposit`,
    typeArguments: [ctx.coinType],
    arguments: [tx.object(ctx.vaultId), tx.object(coins[0].coinObjectId)],
  });
  return tx;
}

export function ReceivePanel({ vaultCtx }: { vaultCtx: VaultTxContext }) {
  // Read address in useEffect — getSession() reads sessionStorage which is
  // unavailable during SSR/hydration, so calling it at render time always
  // returns null and the QR effect never fires.
  const [address, setAddress] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [ownedCoins, setOwnedCoins] = useState<OwnedCoin[] | null>(null);
  const [depositState, setDepositState] = useState<'idle' | 'loading' | 'depositing' | 'success' | 'error'>('idle');
  const [depositError, setDepositError] = useState('');
  const [depositDigest, setDepositDigest] = useState('');

  useEffect(() => {
    const session = getSession();
    setAddress(session?.address ?? '');
  }, []);

  // Generate QR code once address is known
  useEffect(() => {
    if (!address) return;
    import('qrcode').then((mod) => {
      const QRCode = mod.default ?? mod;
      (QRCode as { toDataURL: (text: string, opts: object) => Promise<string> })
        .toDataURL(address, { width: 200, margin: 2, color: { dark: '#f1f5f9', light: '#0f172a' } })
        .then(setQrDataUrl)
        .catch(() => { /* leave placeholder visible on error */ });
    });
  }, [address]);

  // Check for owned coins the user can deposit
  const checkWallet = useCallback(async () => {
    if (!address || !vaultCtx.coinType) return;
    setDepositState('loading');
    try {
      const coins = await fetchOwnedCoins(address, vaultCtx.coinType);
      setOwnedCoins(coins);
      setDepositState('idle');
    } catch {
      setOwnedCoins([]);
      setDepositState('idle');
    }
  }, [address, vaultCtx.coinType]);

  useEffect(() => { void checkWallet(); }, [checkWallet]);

  const handleDeposit = async () => {
    if (!ownedCoins || ownedCoins.length === 0) return;
    setDepositState('depositing');
    setDepositError('');
    try {
      const tx = buildDepositTx(ownedCoins, vaultCtx);
      const result = await executeTransaction(tx) as { digest: string };
      setDepositDigest(result.digest ?? '');
      setDepositState('success');
      window.dispatchEvent(new CustomEvent('cashpan:refresh'));
      // Re-check wallet after deposit (coins should be gone)
      setTimeout(() => void checkWallet(), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const friendly = msg.includes('sponsor') ? "Couldn't sponsor the transaction — try again."
        : msg.includes('network') || msg.includes('fetch') ? 'Network issue. Try again.'
        : 'Deposit failed. Please try again.';
      setDepositError(friendly);
      setDepositState('error');
    }
  };

  const totalOwned = ownedCoins?.reduce((sum, c) => sum + BigInt(c.balance), 0n) ?? 0n;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '1.5rem 1.25rem', gap: '1.5rem' }}>

      {/* Address + QR */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="Your CashPan address QR code"
            width={180}
            height={180}
            style={{ borderRadius: '0.75rem', border: '1px solid var(--color-border)' }}
          />
        ) : (
          <div style={{ width: 180, height: 180, background: 'rgba(255,255,255,0.04)', borderRadius: '0.75rem', border: '1px solid var(--color-border)' }} />
        )}

        <div style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--color-text)', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.25rem' }}>
            Your address
          </div>
          <div style={{ color: 'var(--color-muted)', fontSize: '0.78rem', lineHeight: 1.5 }}>
            Share this to receive {COIN_SYM}. Coins sent here land in your wallet.
          </div>
        </div>

        {address && <CopyChip value={address} label="Address" />}
      </div>

      {/* Divider */}
      <div style={{ height: '1px', background: 'var(--color-border)' }} />

      {/* Add to CashPan */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-text)' }}>
          Add to CashPan
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)', lineHeight: 1.55 }}>
          If you've received {COIN_SYM} to your address, tap below to move it into your Spend pocket.
        </div>

        {depositState === 'loading' && (
          <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)' }}>Checking your wallet…</div>
        )}

        {depositState !== 'loading' && ownedCoins !== null && ownedCoins.length === 0 && depositState !== 'success' && (
          <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)', fontStyle: 'italic' }}>
            No {COIN_SYM} found in your wallet yet.
          </div>
        )}

        {depositState !== 'loading' && ownedCoins !== null && ownedCoins.length > 0 && depositState !== 'success' && (
          <>
            <div style={{ fontSize: '0.82rem', color: 'var(--color-savings)', fontWeight: 600 }}>
              {baseToHuman(totalOwned.toString())} {COIN_SYM} available in your wallet
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
              {depositState === 'depositing' ? 'Adding to CashPan…' : `Add ${baseToHuman(totalOwned.toString())} ${COIN_SYM} to Spend`}
            </button>
          </>
        )}

        {depositState === 'success' && (
          <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '0.625rem', padding: '0.75rem 1rem' }}>
            <div style={{ color: 'var(--color-savings)', fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.25rem' }}>
              ✓ Added to your Spend pocket
            </div>
            <div style={{ color: 'var(--color-muted)', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
              {depositDigest.slice(0, 12)}…{depositDigest.slice(-8)}
            </div>
          </div>
        )}

        {depositState === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.82rem', color: 'rgba(252,165,165,0.9)' }}>{depositError}</div>
            <button
              onClick={handleDeposit}
              style={{ background: 'var(--color-savings)', color: '#0a0f1e', border: 'none', borderRadius: '0.625rem', padding: '0.625rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', minHeight: '44px' }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
