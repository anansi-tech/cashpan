'use client';

interface CashPanVisualProps {
  /** 0–100, how full the pan is (savings / total) */
  fillPercent: number;
  /** display label shown in the pan */
  label?: string;
}

export function CashPanVisual({ fillPercent, label }: CashPanVisualProps) {
  const fill = Math.max(0, Math.min(100, fillPercent));

  // Pan interior spans y=52 (rim) to y=162 (bottom). Total height = 110px.
  // When fill=100, rect top is at y=52 (full). When fill=0, rect top is at y=162 (empty).
  const rectY = 162 - (fill / 100) * 110;

  // Liquid surface ellipse: narrows toward bottom of pan
  const surfaceRx = 90 + (fill / 100) * 30; // narrower when low
  const surfaceCy = rectY + 2;

  return (
    <div className="relative flex flex-col items-center gap-3">
      <svg
        viewBox="0 0 320 220"
        className="w-full max-w-[340px] drop-shadow-2xl"
        aria-label={`Savings pan ${fill.toFixed(0)}% full`}
      >
        <defs>
          <style>{`
            @keyframes steam-rise {
              0%   { opacity: 0;   transform: translateY(0)     scaleX(1);   }
              25%  { opacity: 0.6;                                            }
              100% { opacity: 0;   transform: translateY(-26px) scaleX(0.35); }
            }
          `}</style>

          {/* Clip path matches the pan interior */}
          <clipPath id="pan-clip">
            <path d="M 24 54 L 12 160 Q 160 176 308 160 L 296 54 Q 160 40 24 54 Z" />
          </clipPath>

          {/* Savings fill gradient */}
          <linearGradient id="savings-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#047857" />
          </linearGradient>

          {/* Pan body gradient */}
          <linearGradient id="pan-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e2d3d" />
            <stop offset="100%" stopColor="#0d1a26" />
          </linearGradient>

          {/* Rim gradient */}
          <linearGradient id="pan-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2d4a63" />
            <stop offset="100%" stopColor="#1a3244" />
          </linearGradient>

          {/* Surface shimmer */}
          <radialGradient id="shimmer" cx="50%" cy="30%" r="60%">
            <stop offset="0%" stopColor="rgba(167, 243, 208, 0.35)" />
            <stop offset="100%" stopColor="rgba(16, 185, 129, 0)" />
          </radialGradient>
        </defs>

        {/* ── Pan body background ── */}
        <path
          d="M 22 56 L 10 162 Q 160 178 310 162 L 298 56 Q 160 42 22 56 Z"
          fill="url(#pan-body)"
        />

        {/* ── Savings fill (clipped to interior) ── */}
        <rect
          x="0"
          y={rectY}
          width="320"
          height="220"
          fill="url(#savings-fill)"
          clipPath="url(#pan-clip)"
          style={{ transition: 'y 1.8s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />

        {/* ── Liquid surface shimmer ── */}
        {fill > 2 && (
          <ellipse
            cx="160"
            cy={surfaceCy}
            rx={surfaceRx}
            ry={4.5}
            fill="url(#shimmer)"
            clipPath="url(#pan-clip)"
            style={{ transition: 'cy 1.8s cubic-bezier(0.4, 0, 0.2, 1), rx 1.8s ease' }}
          />
        )}

        {/* ── Pan border (drawn over fill) ── */}
        <path
          d="M 22 56 L 10 162 Q 160 178 310 162 L 298 56"
          fill="none"
          stroke="#2d4a63"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* ── Rim ellipse (top opening) ── */}
        <ellipse
          cx="160"
          cy="54"
          rx="138"
          ry="20"
          fill="url(#pan-rim)"
          stroke="#3d6280"
          strokeWidth="2.5"
        />

        {/* ── Inner rim highlight ── */}
        <ellipse
          cx="160"
          cy="54"
          rx="125"
          ry="13"
          fill="none"
          stroke="rgba(100, 200, 180, 0.12)"
          strokeWidth="1"
        />

        {/* ── Handle ── */}
        <g>
          {/* Handle tube */}
          <rect
            x="308"
            y="82"
            width="60"
            height="20"
            rx="10"
            fill="#1e2d3d"
            stroke="#2d4a63"
            strokeWidth="2"
          />
          {/* Handle grip detail */}
          <rect x="316" y="88" width="44" height="8" rx="4" fill="#0d1a26" />
          {/* Handle end cap */}
          <circle cx="370" cy="92" r="8" fill="#1e2d3d" stroke="#2d4a63" strokeWidth="2" />
        </g>

        {/* ── Steam wisps above rim (only when there's liquid) ── */}
        {fill > 3 && (
          <g style={{ opacity: 0.85 }}>
            <ellipse cx="118" cy="42" rx="8" ry="3.5" fill="rgba(52,211,153,0.28)"
              style={{ animation: 'steam-rise 2.8s ease-out 0s infinite', transformOrigin: '118px 42px' }} />
            <ellipse cx="160" cy="38" rx="6" ry="2.8" fill="rgba(52,211,153,0.22)"
              style={{ animation: 'steam-rise 2.8s ease-out 1.1s infinite', transformOrigin: '160px 38px' }} />
            <ellipse cx="200" cy="41" rx="7" ry="3.2" fill="rgba(52,211,153,0.26)"
              style={{ animation: 'steam-rise 2.8s ease-out 0.55s infinite', transformOrigin: '200px 41px' }} />
          </g>
        )}

        {/* ── Label inside pan ── */}
        {label && fill < 85 && (
          <text
            x="160"
            y={Math.max(rectY - 14, 68)}
            textAnchor="middle"
            fill="rgba(100, 200, 160, 0.6)"
            fontSize="11"
            fontFamily="ui-monospace, monospace"
            style={{ transition: 'y 1.8s cubic-bezier(0.4, 0, 0.2, 1)' }}
          >
            {label}
          </text>
        )}
      </svg>

      {/* Fill percent label */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[--color-muted]">savings</span>
        <span
          className="font-mono text-[--color-savings] font-medium"
          style={{ minWidth: '3.5rem', textAlign: 'right' }}
        >
          {fill.toFixed(1)}%
        </span>
        <span className="text-[--color-muted]">of total</span>
      </div>
    </div>
  );
}
