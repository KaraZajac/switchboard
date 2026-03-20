/**
 * SwitchboardIcon — no background, transparent
 *
 * Props:
 *   fg        — stroke/fill color  (default: "#1a1a2e")
 *   size      — width & height in px (default: 48)
 *   style     — additional inline styles
 *   className — additional class names
 *
 * Usage:
 *   <SwitchboardIcon />
 *   <SwitchboardIcon fg="#f5c842" size={128} />
 *   <SwitchboardIcon fg="var(--icon-color)" size={32} />
 */

const SwitchboardIcon = ({
  fg = "#1a1a2e",
  size = 48,
  style = {},
  className = "",
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="180 210 260 260"
    width={size}
    height={size}
    aria-label="Switchboard"
    role="img"
    style={style}
    className={className}
  >
    {/* Top row of jacks */}
    {[240, 310, 380].map((cx) => (
      <circle key={`top-${cx}`} cx={cx} cy="265" r="12"
        fill="none" stroke={fg} strokeWidth="5" />
    ))}

    {/* Bottom row of jacks */}
    {[240, 310, 380].map((cx) => (
      <circle key={`bot-${cx}`} cx={cx} cy="415" r="12"
        fill="none" stroke={fg} strokeWidth="5" />
    ))}

    {/* Patch cables */}
    <path d="M240 277 C240 345 310 345 310 403"
      fill="none" stroke={fg} strokeWidth="5" strokeLinecap="round" />
    <path d="M310 277 C310 315 380 315 380 403"
      fill="none" stroke={fg} strokeWidth="5" strokeLinecap="round" />
    <path d="M380 277 C380 355 240 355 240 403"
      fill="none" stroke={fg} strokeWidth="5" strokeLinecap="round" />

    {/* Plugged-in indicators */}
    {[[240, 265], [310, 265], [310, 415], [380, 415]].map(([cx, cy]) => (
      <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r="5" fill={fg} />
    ))}
  </svg>
);

export default SwitchboardIcon;
