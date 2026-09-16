/**
 * Where a conversation has been read up to.
 *
 * `draft/read-marker` is the thing that stops catching up in bed and still
 * finding forty unread in the morning: the position is the network's, not the
 * device's, and every device pushes its own forward and hears about everyone
 * else's.
 *
 * Which is why it only ever moves forward. A marker arrives from at least
 * three directions — this device reading, this device's own stored copy read
 * back at startup, and the server echoing somebody else's `MARKREAD` — and
 * they do not arrive in order. The phone's database has refused to move it
 * back since it was written. The desktop replaced the value wherever it was
 * told one, in the database and in the window both, so whichever of the three
 * landed last won: read a channel, have the startup load finish a moment
 * later, and the lines you had just read were unread again.
 *
 * That is the "same messages popping up as unread" nobody could reproduce on
 * purpose, because reproducing it means losing a race.
 */

/**
 * The further of two positions, or null when there is no usable one.
 *
 * Compared as text, which for ISO-8601 in UTC is the same as comparing the
 * instants and is what `@shared/unread` already does. A marker that is not
 * one of those — `*`, which is how a server says it holds none, or an empty
 * string — is not a position and cannot move anything.
 */
export function furthestRead(
  known: string | null | undefined,
  arriving: string | null | undefined
): string | null {
  const from = position(known)
  const to = position(arriving)

  if (from === null) return to
  if (to === null) return from
  return to > from ? to : from
}

/** Whether a marker should be written down at all */
export function movesForward(
  known: string | null | undefined,
  arriving: string | null | undefined
): boolean {
  const to = position(arriving)
  if (to === null) return false

  const from = position(known)
  return from === null || to > from
}

/**
 * A timestamp, or null for the ways a server says it has none.
 *
 * `MARKREAD <target> *` is the answer to asking about a conversation nobody
 * has marked yet. Reading the `*` as a position would sort above every real
 * timestamp and mark the whole conversation read.
 */
function position(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed === '*') return null
  return trimmed
}
