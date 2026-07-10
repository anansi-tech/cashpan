'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { relativeTime } from '@/lib/utils';
import type { ActivityEvent } from '@/lib/read-layer';
import { useVaultData } from './VaultDataProvider';

const NETWORK = process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'mainnet';

function suiscanUrl(digest: string): string {
  return `https://suiscan.xyz/${NETWORK}/tx/${digest}`;
}

function eventIcon(ev: ActivityEvent): string {
  if (ev.type === 'rebalance') return ev.direction === 0 ? '↗' : '↙';
  if (ev.type === 'withdraw') return '↩';
  return '→';
}

function eventColor(ev: ActivityEvent): string {
  if (ev.type === 'rebalance') return ev.direction === 0 ? 'var(--color-savings)' : 'var(--color-liquid)';
  return 'var(--color-muted)';
}

// ─── Detail drawer ─────────────────────────────────────────────────────────────

function DetailDrawer({ ev, onClose }: { ev: ActivityEvent; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyDigest = () => {
    navigator.clipboard.writeText(ev.digest).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 40, display: 'flex', alignItems: 'flex-end' }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} />

      {/* Sheet */}
      <div
        style={{
          position: 'relative', zIndex: 1, width: '100%',
          background: 'var(--color-surface)',
          borderRadius: '1rem 1rem 0 0',
          borderTop: '1px solid var(--color-border)',
          padding: '1.25rem 1.25rem 2rem',
          display: 'flex', flexDirection: 'column', gap: '0.875rem',
          maxHeight: '70vh', overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div style={{ width: '2.5rem', height: '3px', borderRadius: '2px', background: 'var(--color-border)', alignSelf: 'center', marginBottom: '0.25rem' }} />

        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: '30px', height: '30px', borderRadius: '50%',
            background: 'rgba(255,255,255,0.04)', border: `1px solid ${eventColor(ev)}33`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.85rem', color: eventColor(ev), fontFamily: 'var(--font-mono)', fontWeight: 700, flexShrink: 0,
          }}>
            {eventIcon(ev)}
          </div>
          <div style={{ flex: 1, fontSize: '0.9rem', color: 'var(--color-text)', fontWeight: 600 }}>
            {ev.text}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '1.1rem', minWidth: '36px', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ✕
          </button>
        </div>

        <div style={{ height: '1px', background: 'var(--color-border)' }} />

        {/* Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          <DetailRow label="Time" value={relativeTime(ev.timestampMs)} />
          {ev.epochStr && <DetailRow label="Epoch" value={ev.epochStr} />}

          {/* Digest — copyable + external link */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: 'var(--color-muted)', fontSize: '0.8rem', flexShrink: 0 }}>Tx</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 }}>
              <button
                onClick={copyDigest}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  color: copied ? 'var(--color-savings)' : 'var(--color-muted-2)',
                  fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 600,
                  transition: 'color 0.15s',
                }}
                title={ev.digest}
              >
                {copied ? '✓ copied' : `${ev.digest.slice(0, 10)}…${ev.digest.slice(-8)}`}
              </button>
              <a
                href={suiscanUrl(ev.digest)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--color-muted)', fontSize: '0.75rem', textDecoration: 'none', flexShrink: 0, opacity: 0.7 }}
                title="View on Suiscan"
              >
                ↗
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
      <span style={{ color: 'var(--color-muted)', fontSize: '0.8rem', flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--color-text)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ─── Inline detail (desktop expand) ──────────────────────────────────────────

function InlineDetail({ ev }: { ev: ActivityEvent }) {
  const [copied, setCopied] = useState(false);
  const copyDigest = () => {
    navigator.clipboard.writeText(ev.digest).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const rowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' };
  const labelStyle: CSSProperties = { color: 'var(--color-muted)', fontSize: '0.75rem', flexShrink: 0 };
  const valueStyle: CSSProperties = { color: 'var(--color-text)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600 };
  return (
    <div style={{ borderTop: '1px solid rgba(148,163,184,0.1)', paddingTop: '0.5rem', paddingBottom: '0.625rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={rowStyle}>
        <span style={labelStyle}>Time</span>
        <span style={valueStyle}>{relativeTime(ev.timestampMs)}</span>
      </div>
      {ev.epochStr && (
        <div style={rowStyle}>
          <span style={labelStyle}>Epoch</span>
          <span style={valueStyle}>{ev.epochStr}</span>
        </div>
      )}
      <div style={rowStyle}>
        <span style={labelStyle}>Tx</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); copyDigest(); }}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: copied ? 'var(--color-savings)' : 'var(--color-muted-2)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 600, transition: 'color 0.15s' }}
            title={ev.digest}
          >
            {copied ? '✓ copied' : `${ev.digest.slice(0, 10)}…${ev.digest.slice(-8)}`}
          </button>
          <a
            href={suiscanUrl(ev.digest)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: 'var(--color-muted)', fontSize: '0.75rem', textDecoration: 'none', flexShrink: 0, opacity: 0.7 }}
            title="View on Suiscan"
          >
            ↗
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Feed row ─────────────────────────────────────────────────────────────────

function FeedRow({ ev, index, total, onTap, isExpanded }: { ev: ActivityEvent; index: number; total: number; onTap: () => void; isExpanded?: boolean }) {
  return (
    <div
      onClick={onTap}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.6rem 0',
        borderBottom: !isExpanded && index < total - 1 ? '1px solid var(--color-border)' : 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.75'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
    >
      <div style={{
        width: '26px', height: '26px', borderRadius: '50%',
        background: 'rgba(255,255,255,0.04)', border: `1px solid ${eventColor(ev)}33`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.75rem', color: eventColor(ev), flexShrink: 0,
        fontFamily: 'var(--font-mono)', fontWeight: 700,
      }}>
        {eventIcon(ev)}
      </div>

      <div style={{ flex: 1, minWidth: 0, fontSize: '0.875rem', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isExpanded ? 600 : undefined }}>
        {ev.text}
      </div>

      <div style={{ color: 'var(--color-muted)', fontSize: isExpanded ? '0.625rem' : '0.75rem', flexShrink: 0 }}>
        {isExpanded ? '▲' : relativeTime(ev.timestampMs)}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ActivityFeed({ flush }: { flush?: boolean }) {
  const { activity: events } = useVaultData();
  const [updatedAt, setUpdatedAt] = useState<number>(Date.now());
  const [expanded, setExpanded] = useState(false);
  const [extraEvents, setExtraEvents] = useState<ActivityEvent[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detail, setDetail] = useState<ActivityEvent | null>(null);
  const [expandedDigest, setExpandedDigest] = useState<string | null>(null);

  useEffect(() => { setUpdatedAt(Date.now()); }, [events]);

  useEffect(() => {
    if (!expandedDigest) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedDigest(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expandedDigest]);

  const handleRowTap = (ev: ActivityEvent) => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setExpandedDigest((prev) => (prev === ev.digest ? null : ev.digest));
    } else {
      setDetail(ev);
    }
  };

  // When expanded, merge the live page-1 events (refreshed by the 5s poll) on
  // top of the deeper one-time snapshot — otherwise the feed freezes at the
  // Show-more click and new activity never appears without a hard refresh.
  // Key includes more than digest: one tx can emit multiple events.
  const evKey = (e: ActivityEvent) => `${e.digest}|${e.type}|${e.direction ?? ''}|${e.amount}|${e.timestampMs ?? ''}`;
  const displayed = expanded
    ? [...events, ...extraEvents.filter((e) => !events.some((p) => evKey(p) === evKey(e)))]
    : events;

  const handleShowMore = async () => {
    setLoadingMore(true);
    try {
      const res = await fetch('/api/activity?limit=100');
      if (res.ok) { setExtraEvents(await res.json()); setExpanded(true); }
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      {detail && <DetailDrawer ev={detail} onClose={() => setDetail(null)} />}

      <div style={{ display: 'flex', flexDirection: 'column', borderTop: flush ? 'none' : '1px solid var(--color-border)', paddingTop: flush ? 0 : '1.25rem', marginTop: flush ? 0 : '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-muted)', fontWeight: 600 }}>
            Agent Activity
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-muted-2)' }}>
            updated {relativeTime(updatedAt.toString())}
          </span>
        </div>

        {displayed.length === 0 ? (
          <div style={{ padding: '0.5rem 0', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div style={{ color: 'var(--color-muted)', fontSize: '0.85rem' }}>
              No activity yet — the agent will start working once your vault has funds.
            </div>
            <div style={{ color: 'var(--color-muted-2)', fontSize: '0.78rem', lineHeight: 1.6 }}>
              When your Spend pocket grows past your buffer, the agent sweeps the extra into Save automatically.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {displayed.map((ev, i) => {
              const isExpanded = expandedDigest === ev.digest;
              if (isExpanded) {
                return (
                  <div
                    key={ev.digest + i}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(148,163,184,0.15)',
                      borderRadius: '0.625rem',
                      margin: '0.375rem -0.625rem',
                      padding: '0 0.625rem',
                    }}
                  >
                    <FeedRow ev={ev} index={i} total={displayed.length} onTap={() => handleRowTap(ev)} isExpanded />
                    <InlineDetail ev={ev} />
                  </div>
                );
              }
              return (
                <FeedRow key={ev.digest + i} ev={ev} index={i} total={displayed.length} onTap={() => handleRowTap(ev)} />
              );
            })}

            {!expanded && events.length >= 10 && (
              <button
                onClick={handleShowMore}
                disabled={loadingMore}
                style={{
                  marginTop: '0.75rem', background: 'transparent',
                  border: '1px solid rgba(148,163,184,0.18)', borderRadius: '0.5rem',
                  padding: '0.4rem 0.75rem', color: 'var(--color-muted)', fontSize: '0.78rem',
                  cursor: loadingMore ? 'wait' : 'pointer', alignSelf: 'center',
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
    </>
  );
}
