'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolUIPart, getToolName } from 'ai';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { ConfirmCard } from './ConfirmCard';
import type { Proposal } from '@/lib/propose';
import type { VaultTxContext } from '@/lib/vault-tx';

export function ChatPanel({ onRefresh, vaultCtx }: { onRefresh?: () => void; vaultCtx: VaultTxContext }) {
  const [inputText, setInputText] = useState('');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const transport = useMemo(() => new DefaultChatTransport(), []);
  const { messages, sendMessage, status } = useChat({ transport });

  const isStreaming = status === 'streaming' || status === 'submitted';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const onPrefill = (e: Event) => {
      const { text } = (e as CustomEvent<{ text: string }>).detail;
      setInputText(text);
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(text.length, text.length);
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 200) + 'px';
      }
    };
    window.addEventListener('cashpan:prefill-chat', onPrefill);
    return () => window.removeEventListener('cashpan:prefill-chat', onPrefill);
  }, []);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isStreaming) return;
    setInputText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    await sendMessage({ text });
  };

  const handleSuccess = () => { onRefresh?.(); };
  const canSend = !!inputText.trim() && !isStreaming;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.25rem 0.5rem' }}>
        <div style={{ maxWidth: '720px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {messages.length === 0 && <EmptyState onSend={(text) => { void sendMessage({ text }); }} disabled={isStreaming} />}

          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              dismissed={dismissed}
              confirmed={confirmed}
              onDismiss={(id) => {
                setDismissed((prev) => new Set([...prev, id]));
                setConfirmed((prev) => new Set([...prev, id]));
              }}
              onConfirm={(id) => setConfirmed((prev) => new Set([...prev, id]))}
              onSuccess={handleSuccess}
              vaultCtx={vaultCtx}
            />
          ))}

          {isStreaming && <ThinkingIndicator />}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div style={{ padding: '0.75rem 1rem 1rem', flexShrink: 0 }}>
        <div style={{ maxWidth: '720px', width: '100%', margin: '0 auto' }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid ${focused ? 'rgba(16,185,129,0.45)' : 'rgba(148,163,184,0.18)'}`,
          borderRadius: '1rem',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          boxShadow: focused ? '0 0 0 3px rgba(16,185,129,0.08)' : 'none',
        }}>
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => { setInputText(e.target.value); autoResize(); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Ask about your balance, or say 'send mom 0.05'…"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '0.875rem 1rem 0.375rem',
              color: 'var(--color-text)',
              resize: 'none',
              fontFamily: 'inherit',
              fontSize: '0.9375rem',
              outline: 'none',
              lineHeight: 1.6,
              minHeight: '4.5rem',
              maxHeight: '12rem',
              overflowY: 'auto',
              width: '100%',
            }}
          />
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '0.375rem 0.625rem 0.5rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-muted-2)', flex: 1, paddingLeft: '0.25rem', userSelect: 'none' }}>
              Shift+Enter for new line
            </span>
            <button
              className="chat-send-btn"
              onClick={handleSend}
              disabled={!canSend}
              title="Send"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '2rem',
                height: '2rem',
                borderRadius: '0.5rem',
                border: 'none',
                background: canSend ? 'var(--color-savings)' : 'rgba(255,255,255,0.06)',
                color: canSend ? '#0a0f1e' : 'var(--color-muted)',
                cursor: canSend ? 'pointer' : 'not-allowed',
                transition: 'background 0.15s, color 0.15s',
                flexShrink: 0,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path d="M7.5 2L7.5 13M7.5 2L3 6.5M7.5 2L12 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

// ─── Per-message renderer ─────────────────────────────────────────────────────

function ChatMessage({
  message,
  dismissed,
  confirmed,
  onDismiss,
  onConfirm,
  onSuccess,
  vaultCtx,
}: {
  message: UIMessage;
  dismissed: Set<string>;
  confirmed: Set<string>;
  onDismiss: (id: string) => void;
  onConfirm: (id: string) => void;
  onSuccess: (digest: string) => void;
  vaultCtx: VaultTxContext;
}) {
  const isUser = message.role === 'user';

  // Collect text across all text parts
  const text = message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');

  // Collect proposal tool parts. In AI SDK v6, tool parts are either
  // ToolUIPart (type='tool-proposeSend') or DynamicToolUIPart (type='dynamic-tool').
  // isToolUIPart + getToolName handle both; check state separately.
  type LoosePart = Record<string, unknown>;
  const proposalParts = (message.parts as LoosePart[]).filter((p) => {
    if (!isToolUIPart(p as never)) return false;
    const name = getToolName(p as never);
    return name.startsWith('propose') && p['state'] === 'output-available';
  });

  if (!text && proposalParts.length === 0) return null;

  // Hide the "Queued a send…" text once the user confirms the action card
  const hasConfirmedProposal = proposalParts.some((p) => confirmed.has(p['toolCallId'] as string));
  const showText = text && !hasConfirmedProposal;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      {/* Text bubble first — gives context before the action card */}
      {showText && (
        <div style={{
          maxWidth: '88%',
          padding: '0.625rem 0.875rem',
          borderRadius: isUser ? '1rem 1rem 0.25rem 1rem' : '1rem 1rem 1rem 0.25rem',
          background: isUser ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${isUser ? 'rgba(16,185,129,0.22)' : 'var(--color-border)'}`,
          color: 'var(--color-text)',
          fontSize: '0.875rem',
          lineHeight: 1.65,
          whiteSpace: 'pre-wrap',
        }}>
          {text}
        </div>
      )}

      {/* Proposal cards after text — user reads context first, then acts */}
      {!isUser && proposalParts.map((part) => {
        const callId = part['toolCallId'] as string;
        return dismissed.has(callId) ? null : (
          <ConfirmCard
            key={callId}
            proposal={part['output'] as Proposal}
            onDismiss={() => onDismiss(callId)}
            onSuccess={(digest) => { onConfirm(callId); onSuccess(digest); }}
            vaultCtx={vaultCtx}
          />
        );
      })}
    </div>
  );
}

const COIN_SYM = process.env.NEXT_PUBLIC_COIN_SYMBOL ?? 'USD';

const CHIPS = ["What's my balance?", "Send mom $10", "Put $20 in Save", "Move $5 to Spend"];

function EmptyState({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  return (
    <div style={{ color: 'var(--color-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '3rem 1rem', lineHeight: 1.7 }}>
      <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>💬</div>
      <div>Tell me what you want to do with your money.</div>
      <div style={{ marginTop: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.625rem', justifyContent: 'center', maxWidth: '560px', margin: '1rem auto 0' }}>
        {CHIPS.map((label) => (
          <button
            key={label}
            onClick={() => onSend(label)}
            disabled={disabled}
            style={{
              border: '1px solid rgba(148,163,184,0.2)',
              borderRadius: '999px',
              padding: '0.5rem 1rem',
              fontSize: '0.84rem',
              color: '#94a3b8',
              background: 'transparent',
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!disabled) {
                e.currentTarget.style.borderColor = 'rgba(16,185,129,0.45)';
                e.currentTarget.style.color = 'var(--color-text)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(148,163,184,0.2)';
              e.currentTarget.style.color = '#94a3b8';
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.25rem 0.5rem' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: 'var(--color-savings)', opacity: 0.6,
          animation: `cashpan-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
      <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)', marginLeft: '2px' }}>Thinking…</span>
    </div>
  );
}
