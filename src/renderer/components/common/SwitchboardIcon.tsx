interface SwitchboardIconProps {
  bg?: string
  fg?: string
  size?: number
  rounded?: number
  className?: string
}

export function SwitchboardIcon({
  bg = '#1a1a2e',
  fg = '#e8d5b7',
  size = 48,
  rounded = 0.2,
  className = ''
}: SwitchboardIconProps) {
  const scale = 680
  const rx = scale * rounded

  // Content bounds with padding
  const pad = 20
  const vx = 170 - pad
  const vy = 190 - pad
  const vw = 310 + pad * 2
  const vh = 290 + pad * 2

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      width={size}
      height={size}
      aria-label="Switchboard"
      role="img"
      className={className}
    >
      <rect x={vx} y={vy} width={vw} height={vh} rx={rx} fill={bg} />
      <rect x="190" y="210" width="300" height="260" rx="12" fill="none" stroke={fg} strokeWidth="6" />
      {[240, 295, 350, 405, 440].map((cx) => (
        <circle key={`t${cx}`} cx={cx} cy="265" r="12" fill="none" stroke={fg} strokeWidth="5" />
      ))}
      {[240, 295, 350, 405, 440].map((cx) => (
        <circle key={`b${cx}`} cx={cx} cy="390" r="12" fill="none" stroke={fg} strokeWidth="5" />
      ))}
      <path d="M240 277 C240 330 295 330 295 378" fill="none" stroke={fg} strokeWidth="5" strokeLinecap="round" />
      <path d="M295 277 C295 310 405 310 405 378" fill="none" stroke={fg} strokeWidth="5" strokeLinecap="round" />
      <path d="M350 277 C350 345 240 345 240 378" fill="none" stroke={fg} strokeWidth="5" strokeLinecap="round" />
      <path d="M405 277 C405 305 440 305 440 378" fill="none" stroke={fg} strokeWidth="5" strokeLinecap="round" />
      {[[240, 265], [295, 265], [295, 390], [405, 390]].map(([cx, cy]) => (
        <circle key={`d${cx}-${cy}`} cx={cx} cy={cy} r="5" fill={fg} />
      ))}
    </svg>
  )
}
