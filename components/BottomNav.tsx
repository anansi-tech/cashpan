'use client';

export type MobileTab = 'home' | 'activity' | 'send' | 'profile';

const TABS: { id: MobileTab; label: string; icon: string }[] = [
  { id: 'home',     label: 'Home',     icon: '⌂' },
  { id: 'activity', label: 'Activity', icon: '↕' },
  { id: 'send',     label: 'Send',     icon: '↗' },
  { id: 'profile',  label: 'Profile',  icon: '👤' },
];

export function BottomNav({
  active,
  onChange,
}: {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}) {
  return (
    <nav
      style={{
        display: 'flex',
        borderTop: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        flexShrink: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.2rem',
            padding: '0.625rem 0.25rem 0.5rem',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: active === t.id ? 'var(--color-savings)' : 'var(--color-muted)',
            transition: 'color 0.15s',
            minHeight: '52px',
          }}
        >
          <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>{t.icon}</span>
          <span style={{ fontSize: '0.65rem', fontWeight: active === t.id ? 700 : 400, letterSpacing: '0.03em' }}>
            {t.label}
          </span>
          {active === t.id && (
            <div style={{ position: 'absolute', bottom: 0, width: '1.5rem', height: '2px', background: 'var(--color-savings)', borderRadius: '1px' }} />
          )}
        </button>
      ))}
    </nav>
  );
}
