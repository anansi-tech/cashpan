/**
 * Route-level skeleton for the initial server render (fresh login) —
 * data surfaces get shimmer blocks, never spinners or zeroed pockets.
 */
export default function Loading() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '420px' }}>
      <div className="skeleton" style={{ width: '120px', height: '1.4rem' }} />
      <div className="skeleton" style={{ width: '220px', height: '3rem' }} />
      <div className="skeleton" style={{ width: '100%', height: '4.5rem', borderRadius: '0.875rem' }} />
      <div className="skeleton" style={{ width: '100%', height: '4.5rem', borderRadius: '0.875rem' }} />
    </div>
  );
}
