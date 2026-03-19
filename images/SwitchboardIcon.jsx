/**
 * SwitchboardIcon
 *
 * A two-color, themeable SVG icon for the Switchboard IRC client.
 *
 * Props:
 *   bg      — background fill color  (default: "#1a1a2e")
 *   fg      — foreground/detail color (default: "#e8d5b7")
 *   size    — width & height in px    (default: 48)
 *   rounded — corner radius as a fraction of size (default: 0.2)
 *             e.g. size=48, rounded=0.2 → rx≈9.6px (matches iOS squircle feel)
 *   style   — additional inline styles on the <svg> element
 *   className — additional class names
 *
 * Usage:
 *   import SwitchboardIcon from './SwitchboardIcon';
 *
 *   // Default (navy / cream, 48px)
 *   <SwitchboardIcon />
 *
 *   // Black & gold, 128px
 *   <SwitchboardIcon bg="#111111" fg="#f5c842" size={128} />
 *
 *   // White foreground on transparent background (e.g. inside a colored button)
 *   <SwitchboardIcon bg="transparent" fg="#ffffff" size={24} />
 *
 *   // Respond to dark mode via CSS classes
 *   <SwitchboardIcon
 *     bg="var(--icon-bg)"
 *     fg="var(--icon-fg)"
 *     size={32}
 *   />
 */

const SwitchboardIcon = ({
  bg = "#1a1a2e",
  fg = "#e8d5b7",
  size = 48,
  rounded = 0.2,
  style = {},
  className = "",
}) => {
  // The SVG canvas is 680×680. Scale all values proportionally.
  const scale = 680;
  const rx = scale * rounded;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${scale} ${scale}`}
      width={size}
      height={size}
      aria-label="Switchboard"
      role="img"
      style={style}
      className={className}
    >
      {/* Background tile */}
      <rect x="100" y="100" width="480" height="480" rx={rx} fill={bg} />

      {/* Panel body */}
      <rect
        x="190" y="210" width="300" height="260" rx="12"
        fill="none" stroke={fg} strokeWidth="6"
      />

      {/* Top row of jacks */}
      {[240, 295, 350, 405, 440].map((cx) => (
        <circle key={`top-${cx}`} cx={cx} cy="265" r="12"
          fill="none" stroke={fg} strokeWidth="5" />
      ))}

      {/* Bottom row of jacks */}
      {[240, 295, 350, 405, 440].map((cx) => (
        <circle key={`bot-${cx}`} cx={cx} cy="390" r="12"
          fill="none" stroke={fg} strokeWidth="5" />
      ))}

      {/* Patch cables */}
      <path d="M240 277 C240 330 295 330 295 378"
        fill="none" stroke={fg} strokeWidth="5" strokeLinecap="round" />
      <path d="M295 277 C295 310 405 310 405 378"
        fill="none" stroke={fg} strokeWidth="5" strokeLinecap="round" />
      <path d="M350 277 C350 345 240 345 240 378"
        fill="none" stroke={fg} strokeWidth="5" strokeLinecap="round" />
      <path d="M405 277 C405 305 440 305 440 378"
        fill="none" stroke={fg} strokeWidth="5" strokeLinecap="round" />

      {/* Plugged-in indicators (filled center dots) */}
      {[[240, 265], [295, 265], [295, 390], [405, 390]].map(([cx, cy]) => (
        <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r="5" fill={fg} />
      ))}
    </svg>
  );
};

export default SwitchboardIcon;
