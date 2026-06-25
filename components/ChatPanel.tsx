'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolUIPart, getToolName } from 'ai';
import type { UIMessage } from 'ai';
import { useEffect, useRef, useState, useMemo } from 'react';
import { ConfirmCard } from './ConfirmCard';
import type { Proposal } from '@/lib/propose';

export function ChatPanel({ onRefresh }: { onRefresh?: () => void }) {
  const [inputText, setInputText] = useState('');
  // Track which proposal tool calls have been dismissed
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(() => new DefaultChatTransport(), []);
  const { messages, sendMessage, status } = useChat({ transport });

  const isStreaming = status === 'streaming' || status === 'submitted';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isStreaming) return;
    setInputText('');
    await sendMessage({ text });
  };

  const handleSuccess = (digest: string) => {
    onRefresh?.();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        {messages.length === 0 && <EmptyState />}

        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            dismissed={dismissed}
            onDismiss={(id) => setDismissed((prev) => new Set([...prev, id]))}
            onSuccess={handleSuccess}
          />
        ))}

        {isStreaming && <ThinkingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        borderTop: '1px solid var(--color-border)',
        padding: '0.875rem 1rem',
        display: 'flex',
        gap: '0.625rem',
        alignItems: 'flex-end',
        flexShrink: 0,
      }}>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Ask about your balance, or say 'put aside 0.05 SUI'…"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          style={{
            flex: 1,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.75rem',
            padding: '0.625rem 0.875rem',
            color: 'var(--color-text)',
            resize: 'none',
            fontFamily: 'inherit',
            fontSize: '0.875rem',
            outline: 'none',
            lineHeight: 1.5,
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(16,185,129,0.4)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-border)')}
        />
        <button
          onClick={handleSend}
          disabled={!inputText.trim() || isStreaming}
          style={{
            background: inputText.trim() && !isStreaming ? 'var(--color-savings)' : 'rgba(255,255,255,0.04)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.75rem',
            color: inputText.trim() && !isStreaming ? '#0a0f1e' : 'var(--color-muted)',
            padding: '0.625rem 1rem',
            cursor: inputText.trim() && !isStreaming ? 'pointer' : 'not-allowed',
            fontSize: '0.875rem',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ─── Per-message renderer ─────────────────────────────────────────────────────

function ChatMessage({
  message,
  dismissed,
  onDismiss,
  onSuccess,
}: {
  message: UIMessage;
  dismissed: Set<string>;
  onDismiss: (id: string) => void;
  onSuccess: (digest: string) => void;
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      {/* Proposal cards (assistant only) */}
      {!isUser && proposalParts.map((part) => {
        const callId = part['toolCallId'] as string;
        return dismissed.has(callId) ? null : (
          <ConfirmCard
            key={callId}
            proposal={part['output'] as Proposal}
            onDismiss={() => onDismiss(callId)}
            onSuccess={onSuccess}
          />
        );
      })}

      {/* Text bubble */}
      {text && (
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
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ color: 'var(--color-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '3rem 1rem', lineHeight: 1.7 }}>
      <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>💬</div>
      <div>Ask about your money or move it.</div>
      <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--color-muted-2)' }}>
        &ldquo;What&apos;s my balance?&rdquo; &middot; &ldquo;Put aside 0.05 SUI&rdquo;
        <br />
        &ldquo;Move 0.1 to spending&rdquo; &middot; &ldquo;Send mom 0.02 SUI&rdquo;
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '0.25rem 0.5rem' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: 'var(--color-savings)', opacity: 0.6,
          animation: `cashpan-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}
