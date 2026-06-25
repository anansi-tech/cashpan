'use client';

import { useEffect, useState, useCallback } from 'react';
import { relativeTime } from '@/lib/utils';
import type { ActivityEvent } from '@/lib/read-layer';

function eventIcon(ev: ActivityEvent): string {
  if (ev.type === 'rebalance') return ev.direction === 0 ? '↗' : '↙';
  if (ev.type === 'withdraw') return '↩';
  return '→';
}

function eventColor(ev: ActivityEvent): string {
  if (ev.type === 'rebalance') return ev.direction === 0 ? 'var(--color-savings)' : 'var(--color-liquid)';
  return 'var(--color-muted)';
}

interface ActivityFeedProps {
  initial: ActivityEvent[];
}

export function ActivityFeed({ initial }: ActivityFeedProps) {
  const [events, setEvents] = useState<ActivityEvent[]>(initial);
  const [updatedAt, setUpdatedAt] = useState<number>(Date.now());

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/activity?limit=20', { cache: 'no-store' });
      if (!res.ok) return;
      const data: ActivityEvent[] = await res.json();
      setEvents(data);
      setUpdatedAt(Date.now());
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(poll, 30_000);
    return () => clearInterval(interval);
  }, [poll]);

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

      {events.length === 0 ? (
        <div style={{ color: 'var(--color-muted)', fontSize: '0.85rem', padding: '0.5rem 0' }}>
          No activity yet — the agent will start working once your vault has funds.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {events.map((ev, i) => (
            <div
              key={ev.digest + i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.6rem 0',
                borderBottom: i < events.length - 1 ? '1px solid var(--color-border)' : 'none',
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
        </div>
      )}
    </div>
  );
}
