/**
 * What the About page says, in the words both clients use.
 *
 * Only the date needs a rule, and it needs one badly: every runtime has a
 * built-in way to turn a moment into a date somebody can read, and no two of
 * them agree. `toLocaleDateString` on the desktop and `DateTimeFormatter` on
 * the phone would put the same build under two different dates on the same
 * person's two devices, in an app whose whole point is that they are one
 * client. So it is written out by hand, once, and both read from here.
 *
 * The day rather than the moment. A build date is not a timestamp anybody
 * needs to the second, and taking the date straight off the ISO string means
 * no timezone arithmetic and therefore no chance of the two devices landing on
 * different days for the same build.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

/**
 * `2026-09-17T19:20:44.123Z` → `17 September 2026`.
 *
 * Empty for anything that is not a date, because the About page would rather
 * leave the line out than print `Invalid Date` at somebody — an unbuilt or
 * hand-edited build is exactly when this is read, and a wrong answer there is
 * worse than no answer.
 */
export function buildDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/.exec(iso.trim())
  if (!match) return ''

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) return ''
  if (day < 1 || day > 31) return ''

  return `${day} ${MONTHS[month - 1]} ${year}`
}
