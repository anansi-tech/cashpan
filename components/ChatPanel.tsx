'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { useEffect, useRef, useState, useMemo } from 'react';

export function ChatPanel() {
  const [inputText, setInputText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // DefaultChatTransport defaults to /api/chat
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Messages list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.875rem',
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              color: 'var(--color-muted)',
              fontSize: '0.85rem',
              textAlign: 'center',
              padding: '3rem 1rem',
              lineHeight: 1.7,
            }}
          >
            <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>💬</div>
            <div>Ask me anything about your money.</div>
            <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--color-muted-2)' }}>
              &ldquo;What&apos;s my balance?&rdquo; &middot; &ldquo;How much have I earned?&rdquo;
              <br />
              &ldquo;What did the agent do this week?&rdquo; &middot; &ldquo;What&apos;s my setup?&rdquo;
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {isStreaming && <ThinkingIndicator />}

        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div
        style={{
          borderTop: '1px solid var(--color-border)',
          padding: '0.875rem 1rem',
          display: 'flex',
          gap: '0.625rem',
          alignItems: 'flex-end',
          flexShrink: 0,
        }}
      >
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Ask about your balance, earnings, or what the agent did…"
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
            transition: 'border-color 0.15s',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(16,185,129,0.4)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-border)')}
        />
        <button
          onClick={handleSend}
          disabled={!inputText.trim() || isStreaming}
          style={{
            background:
              inputText.trim() && !isStreaming ? 'var(--color-savings)' : 'rgba(255,255,255,0.04)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.75rem',
            color: inputText.trim() && !isStreaming ? '#0a0f1e' : 'var(--color-muted)',
            padding: '0.625rem 1rem',
            cursor: inputText.trim() && !isStreaming ? 'pointer' : 'not-allowed',
            fontSize: '0.875rem',
            fontWeight: 600,
            transition: 'background 0.15s, color 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';

  const text = message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');

  if (!text) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '88%',
          padding: '0.625rem 0.875rem',
          borderRadius: isUser ? '1rem 1rem 0.25rem 1rem' : '1rem 1rem 1rem 0.25rem',
          background: isUser ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${isUser ? 'rgba(16,185,129,0.22)' : 'var(--color-border)'}`,
          color: 'var(--color-text)',
          fontSize: '0.875rem',
          lineHeight: 1.65,
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '0.25rem 0.5rem' }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: 'var(--color-savings)',
            opacity: 0.6,
            animation: `cashpan-pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
