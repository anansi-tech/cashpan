'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useVaultData } from './VaultDataProvider';
import { ContactsPanel } from './ContactsPanel';
import { ConfirmCard } from './ConfirmCard';
import type { VaultTxContext } from '@/lib/vault-tx';
import type { SendProposal } from '@/lib/propose';

const COIN_DEC = parseInt(process.env.NEXT_PUBLIC_COIN_DECIMALS ?? '6', 10);
const COIN_FACTOR = 10 ** COIN_DEC;
const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'USD';
const SUI_RE = /^0x[0-9a-fA-F]{64}$/;

function toHuman(base: string | number): string {
  return (Number(base) / COIN_FACTOR).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function short(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

type Step = 'recipient' | 'amount' | 'confirm' | 'success';

const inputStyle: CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(148,163,184,0.18)',
  borderRadius: '0.625rem',
  padding: '0.625rem 0.875rem',
  color: 'var(--color-text)',
  fontSize: '0.875rem',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
};

// ─── Save-as-contact prompt ───────────────────────────────────────────────────

function SaveContactPrompt({
  address,
  name,
  onNameChange,
  onSave,
  onSkip,
  saving,
  saved,
}: {
  address: string;
  name: string;
  onNameChange: (v: string) => void;
  onSave: () => void;
  onSkip: () => void;
  saving: boolean;
  saved: boolean;
}) {
  if (saved) {
    return (
      <div style={{ fontSize: '0.82rem', color: 'var(--color-savings)', fontWeight: 600 }}>
        ✓ Saved as contact
      </div>
    );
  }
  const canSave = name.trim().length > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: '0.625rem' }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>
        Save {short(address)} as a contact?
      </div>
      <input
        placeholder="Name (e.g. Mom)"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        autoFocus
        style={inputStyle}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(16,185,129,0.4)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(148,163,184,0.18)'; }}
        onKeyDown={(e) => { if (e.key === 'Enter' && canSave) onSave(); }}
      />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={onSave}
          disabled={saving || !canSave}
          style={{
            flex: 1,
            background: canSave ? 'var(--color-savings)' : 'rgba(255,255,255,0.06)',
            color: canSave ? '#0a0f1e' : 'var(--color-muted)',
            border: 'none', borderRadius: '0.5rem', padding: '0.5rem',
            fontSize: '0.82rem', fontWeight: 700,
            cursor: saving || !canSave ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onSkip}
          style={{
            background: 'transparent', color: 'var(--color-muted)',
            border: '1px solid rgba(148,163,184,0.2)', borderRadius: '0.5rem',
            padding: '0.5rem 0.875rem', fontSize: '0.82rem', cursor: 'pointer',
          }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SendSheet({ vaultCtx, onClose }: { vaultCtx: VaultTxContext; onClose: () => void }) {
  const { contacts, balances } = useVaultData();
  const [view, setView] = useState<'send' | 'contacts'>('send');
  const [step, setStep] = useState<Step>('recipient');
  const [recipientLabel, setRecipientLabel] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [pasteInput, setPasteInput] = useState('');
  const [amount, setAmount] = useState('');
  const [proposal, setProposal] = useState<SendProposal | null>(null);
  const [isRawAddress, setIsRawAddress] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactSaved, setContactSaved] = useState(false);
  const [savingContact, setSavingContact] = useState(false);

  const spendHuman = balances ? toHuman(String(balances.liquid)) : '0.00';
  const spendNum = parseFloat(spendHuman.replace(/,/g, ''));

  const pasteAddress = pasteInput.trim();
  const pasteValid = SUI_RE.test(pasteAddress);

  // ConfirmCard's not_a_payee button fires this event to open contacts.
  useEffect(() => {
    const handler = () => setView('contacts');
    window.addEventListener('cashpan:send-panel-contacts-view', handler);
    return () => window.removeEventListener('cashpan:send-panel-contacts-view', handler);
  }, []);

  const selectRecipient = (label: string, address: string, raw = false) => {
    setRecipientLabel(label);
    setRecipientAddress(address);
    setIsRawAddress(raw);
    setContactName('');
    setContactSaved(false);
    setStep('amount');
  };

  const handleAmountNext = () => {
    const amtNum = parseFloat(amount);
    if (!recipientAddress || isNaN(amtNum) || amtNum <= 0) return;
    const p: SendProposal = {
      action: 'send',
      amountSui: amount,
      payeeLabel: recipientLabel,
      recipient: recipientAddress,
      spendBalance: spendHuman.replace(/,/g, ''),
      blocked: amtNum > spendNum ? 'insufficient_liquid' : undefined,
    };
    setProposal(p);
    setStep('confirm');
  };

  const handleSaveContact = async () => {
    setSavingContact(true);
    try {
      await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: contactName.trim(), address: recipientAddress }),
      });
      setContactSaved(true);
    } finally {
      setSavingContact(false);
    }
  };

  // After a successful send with a raw address, pause to offer saving.
  const handleSendSuccess = () => {
    if (isRawAddress && !contactSaved) {
      setStep('success');
    } else {
      onClose();
    }
  };

  const goBack = () => {
    if (step === 'confirm') { setStep('amount'); return; }
    if (step === 'amount') { setAmount(''); setStep('recipient'); }
  };

  // ── Contacts sub-view ───────────────────────────────────────────────────────

  if (view === 'contacts') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <button onClick={() => setView('send')} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '1rem', padding: '0.25rem 0.5rem 0.25rem 0', minHeight: '36px' }}>
              ←
            </button>
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text)' }}>Contacts</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '1.1rem', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Close">✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ContactsPanel />
        </div>
      </div>
    );
  }

  // ── Send flow ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          {step !== 'recipient' && step !== 'success' && (
            <button onClick={goBack} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '1rem', padding: '0.25rem 0.5rem 0.25rem 0', minHeight: '36px' }}>
              ←
            </button>
          )}
          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text)' }}>
            {step === 'recipient' ? 'Send to'
              : step === 'amount' ? `Send to ${recipientLabel}`
              : step === 'confirm' ? 'Confirm send'
              : 'Sent'}
          </span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '1.1rem', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Close">
          ✕
        </button>
      </div>

      {/* Step: Recipient */}
      {step === 'recipient' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Paste address */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Paste address
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                value={pasteInput}
                onChange={(e) => setPasteInput(e.target.value)}
                placeholder="0x… Sui address"
                style={{ ...inputStyle, flex: 1 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(16,185,129,0.4)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(148,163,184,0.18)'; }}
                onKeyDown={(e) => { if (e.key === 'Enter' && pasteValid) selectRecipient(short(pasteAddress), pasteAddress, true); }}
              />
              <button
                onClick={() => pasteValid && selectRecipient(short(pasteAddress), pasteAddress, true)}
                disabled={!pasteValid}
                style={{
                  background: pasteValid ? 'var(--color-savings)' : 'rgba(255,255,255,0.06)',
                  color: pasteValid ? '#0a0f1e' : 'var(--color-muted)',
                  border: 'none', borderRadius: '0.625rem',
                  padding: '0 0.875rem', fontSize: '0.85rem', fontWeight: 700,
                  cursor: pasteValid ? 'pointer' : 'not-allowed', flexShrink: 0,
                  minHeight: '40px', transition: 'background 0.15s, color 0.15s',
                }}
              >
                Next →
              </button>
            </div>
            {pasteInput.trim() && !pasteValid && (
              <div style={{ fontSize: '0.72rem', color: 'rgba(252,165,165,0.8)' }}>
                Must be 0x + 64 hex characters
              </div>
            )}
          </div>

          {/* Contacts */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Contacts
              </div>
              <button
                onClick={() => setView('contacts')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-savings)', fontSize: '0.72rem', fontWeight: 600, padding: 0 }}
              >
                Manage →
              </button>
            </div>

            {contacts.length > 0 ? (
              contacts.map((c) => (
                <button
                  key={c.address}
                  onClick={() => selectRecipient(c.label, c.address)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.75rem 0.875rem',
                    background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)',
                    borderRadius: '0.75rem', cursor: 'pointer', textAlign: 'left', width: '100%',
                    transition: 'background 0.12s, border-color 0.12s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(148,163,184,0.25)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                >
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.85rem', color: 'var(--color-savings)', fontWeight: 700, flexShrink: 0,
                  }}>
                    {c.label[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-text)' }}>{c.label}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{short(c.address)}</div>
                  </div>
                  <span style={{ color: 'var(--color-muted)', fontSize: '0.9rem' }}>→</span>
                </button>
              ))
            ) : (
              <div style={{ color: 'var(--color-muted)', fontSize: '0.82rem', padding: '0.25rem 0' }}>
                No contacts yet — paste an address above.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step: Amount */}
      {step === 'amount' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Amount
            </div>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.875rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted)', fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}>$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                autoFocus
                style={{ ...inputStyle, paddingLeft: '2rem', fontSize: '1.5rem', fontFamily: 'var(--font-mono)', fontWeight: 700, height: '3.5rem' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(16,185,129,0.4)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(148,163,184,0.18)'; }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAmountNext(); }}
              />
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
              Spend available: ${spendHuman} {COIN_SYM}
            </div>
          </div>

          <button
            onClick={handleAmountNext}
            disabled={!amount || parseFloat(amount) <= 0}
            style={{
              background: amount && parseFloat(amount) > 0 ? 'var(--color-savings)' : 'rgba(255,255,255,0.06)',
              color: amount && parseFloat(amount) > 0 ? '#0a0f1e' : 'var(--color-muted)',
              border: 'none', borderRadius: '0.75rem',
              padding: '0.875rem', fontSize: '0.95rem', fontWeight: 700,
              cursor: amount && parseFloat(amount) > 0 ? 'pointer' : 'not-allowed',
              minHeight: '48px', transition: 'background 0.15s, color 0.15s',
            }}
          >
            Review →
          </button>
        </div>
      )}

      {/* Step: Confirm */}
      {step === 'confirm' && proposal && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <ConfirmCard
            proposal={proposal}
            onSuccess={handleSendSuccess}
            onDismiss={() => setStep('amount')}
            vaultCtx={vaultCtx}
          />
          {isRawAddress && !contactSaved && (
            <SaveContactPrompt
              address={recipientAddress}
              name={contactName}
              onNameChange={setContactName}
              onSave={handleSaveContact}
              onSkip={() => setContactSaved(true)}
              saving={savingContact}
              saved={contactSaved}
            />
          )}
        </div>
      )}

      {/* Step: Success + save contact */}
      {step === 'success' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '0.875rem', padding: '0.875rem 1rem' }}>
            <div style={{ color: 'var(--color-savings)', fontSize: '0.875rem', fontWeight: 700 }}>
              ✓ Sent {proposal ? `$${proposal.amountSui} ${COIN_SYM} to ${recipientLabel}` : ''}
            </div>
          </div>
          <SaveContactPrompt
            address={recipientAddress}
            name={contactName}
            onNameChange={setContactName}
            onSave={async () => { await handleSaveContact(); setTimeout(onClose, 800); }}
            onSkip={onClose}
            saving={savingContact}
            saved={contactSaved}
          />
        </div>
      )}
    </div>
  );
}
