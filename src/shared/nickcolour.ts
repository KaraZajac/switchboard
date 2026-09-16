/**
 * The colour a person is, and the colour their initial is written in.
 *
 * Deterministic from the nick, so the same person is the same colour in every
 * channel, on every network, on both clients and under every theme. That last
 * one was not quite true: the desktop named these as Tailwind classes, two of
 * the seventeen (`bg-green-600`, `bg-indigo-600`) are shades every palette
 * redefines, and so two people in seventeen changed colour when you changed
 * theme — and the phone had to copy the accident to stay in step. They are
 * written out here instead, which is what both clients meant all along.
 *
 * The lettering matters more than it sounds. The desktop wrote every initial
 * in white, which on the mint green a Catppuccin palette gave that slot was
 * 2.01:1 — a letter you cannot read. The phone wrote them in the theme's
 * darkest surface, which is dark on twelve themes and light on the thirteenth,
 * so it failed the other way round. Neither could be right, because the circle
 * does not change with the theme and the ink was being chosen as though it
 * did.
 *
 * So the ink is chosen from the circle: whichever of black and white stands
 * out more against it. The worst case over all seventeen is 4.63:1, where
 * always-white was 2.01.
 */

/**
 * Tailwind's own `-600` shades, written out rather than named.
 *
 * Seventeen, one per hue, in the order the hash indexes them — changing the
 * order or the length repaints everybody, so don't.
 */
export const AVATAR_COLOURS = [
  '#e7000b', // red
  '#f54900', // orange
  '#e17100', // amber
  '#d08700', // yellow
  '#5ea500', // lime
  '#00a63e', // green
  '#009966', // emerald
  '#009689', // teal
  '#0092b8', // cyan
  '#0084d1', // sky
  '#155dfc', // blue
  '#4f39f6', // indigo
  '#7f22fe', // violet
  '#9810fa', // purple
  '#c800de', // fuchsia
  '#e60076', // pink
  '#ec003f' // rose
] as const

/** Lettering for a circle of this colour: whichever of the two stands out */
export function avatarInk(background: string): '#ffffff' | '#000000' {
  const white = contrast(1, luminance(background))
  const black = contrast(0, luminance(background))
  return white >= black ? '#ffffff' : '#000000'
}

/**
 * The colour for a nick.
 *
 * FNV-1a, for the spread it gives over short strings — a channel of `dave`,
 * `dave_` and `dave__` should not be three of the same circle.
 */
export function avatarColour(nick: string): string {
  let hash = 2166136261
  for (let at = 0; at < nick.length; at++) {
    hash ^= nick.charCodeAt(at)
    hash = Math.imul(hash, 16777619)
  }
  return AVATAR_COLOURS[Math.abs(hash) % AVATAR_COLOURS.length]
}

/** The circle and its lettering together, which is how they are always used */
export function avatarInkFor(nick: string): { background: string; ink: string } {
  const background = avatarColour(nick)
  return { background, ink: avatarInk(background) }
}

function luminance(hex: string): number {
  const full = hex.replace('#', '')
  const expanded = full.length === 3 ? [...full].map((c) => c + c).join('') : full
  const channel = (at: number): number => {
    const value = parseInt(expanded.slice(at, at + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

function contrast(a: number, b: number): number {
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}
