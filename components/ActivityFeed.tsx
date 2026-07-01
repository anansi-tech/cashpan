'use client';

import { useEffect, useState } from 'react';
import { relativeTime } from '@/lib/utils';
import type { ActivityEvent } from '@/lib/read-layer';
import { useVaultData } from './VaultDataProvider';

function eventIcon(ev: ActivityEvent): string {
  if (ev.type === 'rebalance') return ev.direction === 0 ? '↗' : '↙';
  if (ev.type === 'withdraw') return '↩';
  return '→';
}

function eventColor(ev: ActivityEvent): string {
  if (ev.type === 'rebalance') return ev.direction === 0 ? 'var(--color-savings)' : 'var(--color-liquid)';
  return 'var(--color-muted)';
}

export function ActivityFeed() {
  const { activity: events } = useVaultData();
  const [updatedAt, setUpdatedAt] = useState<number>(Date.now());
  const [expanded, setExpanded] = useState(false);
  const [extraEvents, setExtraEvents] = useState<ActivityEvent[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => { setUpdatedAt(Date.now()); }, [events]);

  const displayed = expanded ? extraEvents : events;

  const handleShowMore = async () => {
    setLoadingMore(true);
    try {
      const res = await fetch('/api/activity?limit=100');
      if (res.ok) {
        setExtraEvents(await res.json());
        setExpanded(true);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0',
        borderTop: '1px solid var(--color-border)',
        paddingTop: '1.25rem',
        marginTop: '0.5rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.75rem',
        }}
      >
        <span
          style={{
            fontSize: '0.7rem',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--color-muted)',
            fontWeight: 600,
          }}
        >
          Agent Activity
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--color-muted-2)' }}>
          updated {relativeTime(updatedAt.toString())}
        </span>
      </div>

      {displayed.length === 0 ? (
        <div style={{ color: 'var(--color-muted)', fontSize: '0.85rem', padding: '0.5rem 0' }}>
          No activity yet — the agent will start working once your vault has funds.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {displayed.map((ev, i) => (
            <div
              key={ev.digest + i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.6rem 0',
                borderBottom: i < displayed.length - 1 ? '1px solid var(--color-border)' : 'none',
              }}
            >
              {/* Icon */}
              <div
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.04)',
                  border: `1px solid ${eventColor(ev)}33`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  color: eventColor(ev),
                  flexShrink: 0,
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                }}
              >
                {eventIcon(ev)}
              </div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '0.875rem',
                    color: 'var(--color-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ev.text}
                </div>
                {ev.epochStr && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-muted)', marginTop: '0.1rem' }}>
                    epoch {ev.epochStr}
                  </div>
                )}
              </div>

              {/* Timestamp */}
              <div style={{ color: 'var(--color-muted)', fontSize: '0.75rem', flexShrink: 0 }}>
                {relativeTime(ev.timestampMs)}
              </div>
            </div>
          ))}

          {!expanded && events.length >= 10 && (
            <button
              onClick={handleShowMore}
              disabled={loadingMore}
              style={{
                marginTop: '0.75rem',
                background: 'transparent',
                border: '1px solid rgba(148,163,184,0.18)',
                borderRadius: '0.5rem',
                padding: '0.4rem 0.75rem',
                color: 'var(--color-muted)',
                fontSize: '0.78rem',
                cursor: loadingMore ? 'wait' : 'pointer',
                alignSelf: 'center',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(148,163,184,0.35)'; e.currentTarget.style.color = 'var(--color-text)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(148,163,184,0.18)'; e.currentTarget.style.color = 'var(--color-muted)'; }}
            >
              {loadingMore ? 'Loading…' : 'Show more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
