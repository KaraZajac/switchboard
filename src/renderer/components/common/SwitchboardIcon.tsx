interface SwitchboardIconProps {
  bg?: string
  fg?: string
  size?: number
  className?: string
}

export function SwitchboardIcon({
  bg = 'transparent',
  fg = '#e8d5b7',
  size = 48,
  className = ''
}: SwitchboardIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="180 210 260 260"
      width={size}
      height={size}
      aria-label="Switchboard"
      role="img"
      className={className}
    >
      {bg !== 'transparent' && (
        <rect x="180" y="210" width="260" height="260" rx="24" fill={bg} />
      )}

      {/* Top row of jacks */}
      {[240, 310, 380].map((cx) => (
        <circle key={`t${cx}`} cx={cx} cy="265" r="12" fill="none" stroke={fg} strokeWidth="5" />
      ))}

      {/* Bottom row of jacks */}
      {[240, 310, 380].map((cx) => (
        <circle key={`b${cx}`} cx={cx} cy="415" r="12" fill="none" stroke={fg} strokeWidth="5" />
      ))}

      {/* Patch cables */}
      <path d="M240 277 C240 345 310 345 310 403" fill="none" stroke={fg} strokeWidth="5" strokeLinecap="round" />
      <path d="M310 277 C310 315 380 315 380 403" fill="none" stroke={fg} strokeWidth="5" strokeLinecap="round" />
      <path d="M380 277 C380 355 240 355 240 403" fill="none" stroke={fg} strokeWidth="5" strokeLinecap="round" />

      {/* Plugged-in indicators */}
      {[[240, 265], [310, 265], [310, 415], [380, 415]].map(([cx, cy]) => (
        <circle key={`d${cx}-${cy}`} cx={cx} cy={cy} r="5" fill={fg} />
      ))}
    </svg>
  )
}
