'use client'

/**
 * Helm brand mark — a radial ship's wheel.
 * hub = you · spokes = the CLI agents (PI / Claude Code / Codex) you take the helm of.
 *
 * Geometry is the finalized design (100×100 viewBox, center 50,50):
 *   6 spokes @ 60° · outer rim r30 · 6 bold radial grips · hub r11,
 *   with an optional gold accent on the top grip as the focal point.
 */
export function HelmLogo({
  size = 24,
  accent = true,
  accentColor = 'var(--role-cron, #F7C26B)',
  className,
  style,
}: {
  /** rendered px size (square) */
  size?: number
  /** show the gold focal grip at 12 o'clock */
  accent?: boolean
  /** color of the focal grip */
  accentColor?: string
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {/* spokes: hub → rim, 6 @ 60° */}
      <g stroke="currentColor" strokeWidth="6.5" strokeLinecap="round">
        <line x1="50" y1="50" x2="50" y2="20" />
        <line x1="50" y1="50" x2="75.98" y2="35" />
        <line x1="50" y1="50" x2="75.98" y2="65" />
        <line x1="50" y1="50" x2="50" y2="80" />
        <line x1="50" y1="50" x2="24.02" y2="65" />
        <line x1="50" y1="50" x2="24.02" y2="35" />
      </g>
      {/* outer rim */}
      <circle
        cx="50"
        cy="50"
        r="30"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
      />
      {/* bold radial grips */}
      <g stroke="currentColor" strokeWidth="10" strokeLinecap="round">
        <line x1="50" y1="20" x2="50" y2="9" />
        <line x1="75.98" y1="35" x2="85.5" y2="29.5" />
        <line x1="75.98" y1="65" x2="85.5" y2="70.5" />
        <line x1="50" y1="80" x2="50" y2="91" />
        <line x1="24.02" y1="65" x2="14.5" y2="70.5" />
        <line x1="24.02" y1="35" x2="14.5" y2="29.5" />
      </g>
      {/* hub */}
      <circle cx="50" cy="50" r="11" fill="currentColor" />
      {/* gold focal grip at 12 o'clock */}
      {accent && (
        <line
          x1="50"
          y1="20"
          x2="50"
          y2="9"
          stroke={accentColor}
          strokeWidth="10"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

/**
 * Helm wordmark: lowercase "helm" with a gold accent dot, matching the web logo lockup.
 */
export function HelmWordmark({
  fontSize = 13.5,
  color = 'var(--fg-strong)',
  accentColor = 'var(--role-cron, #F7C26B)',
}: {
  fontSize?: number
  color?: string
  accentColor?: string
}) {
  return (
    <span
      style={{ fontSize, fontWeight: 600, letterSpacing: '-0.02em', color }}
    >
      helm<span style={{ color: accentColor }}>.</span>
    </span>
  )
}
