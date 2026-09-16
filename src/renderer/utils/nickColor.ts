import { avatarColour, avatarInk } from '@shared/nickcolour'

/**
 * The circle a person's initial sits in, and the ink that reads on it.
 *
 * Inline style rather than a class: the seventeen colours are fixed on purpose
 * — the same person is the same colour on every theme and on the phone — and
 * naming them as Tailwind classes meant two of the seventeen were shades every
 * palette redefines. See `@shared/nickcolour`, which both clients share.
 */
export function nickStyle(nick: string): { backgroundColor: string; color: string } {
  const backgroundColor = avatarColour(nick)
  return { backgroundColor, color: avatarInk(backgroundColor) }
}
