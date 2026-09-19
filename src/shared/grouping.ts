/**
 * Whether a message joins the run above it, or starts its own.
 *
 * Every chat app draws a run of messages from one person as one block: an
 * avatar and a name on the first, and nothing but text under it. The rule for
 * when that run *breaks* was written twice — once in the desktop's
 * `MessageItem` and once in the phone's `MessageList` — and the two drifted,
 * which is a thing you see rather than a thing a test catches.
 *
 * What drifted: the phone let a reply join the run, so a reply sent straight
 * after your own message drew no avatar and no name, only the quoted line and
 * the text — leaving the reply preview hanging in the gutter with nothing
 * underneath it to belong to. And the desktop had no day check at all, so a
 * run could span midnight in silence: 23:59 and 00:01 are two minutes apart,
 * and the desktop draws no day divider either, so nothing said the date had
 * changed. Breaking the run at least puts a timestamp on the new day's first
 * message.
 */

/** What the rule needs to know about a message. Both clients have all of it. */
export interface Runnable {
  nick: string
  type: string
  /** ISO 8601, as it came off `server-time` or was stamped locally */
  timestamp: string
  /** The message this one answers, if any */
  replyTo?: string | null
}

/** A run breaks after this long, however much the same person is talking */
export const RUN_MINUTES = 5

/**
 * Kinds that always stand alone.
 *
 * An emote reads as its own event — `kara waves` carries the name in the
 * sentence — and a system line is not somebody talking at all.
 */
const ALONE = ['action', 'system']

/**
 * `sameDay` is the caller's, not this rule's: which day a timestamp falls on
 * depends on the reader's timezone, and both clients already work that out
 * locally for the day divider. Passing it in keeps this answer the same
 * everywhere it is tested.
 */
export function joinsRun(
  previous: Runnable | null | undefined,
  message: Runnable,
  sameDay = true
): boolean {
  if (!previous) return false
  if (!sameDay) return false
  if (previous.nick !== message.nick) return false
  if (previous.type !== message.type) return false
  if (ALONE.includes(message.type)) return false
  // A reply carries a quoted line above it. Without a name under that, there
  // is nothing saying who is answering.
  if (message.replyTo) return false
  return minutesApart(previous.timestamp, message.timestamp) < RUN_MINUTES
}

/**
 * Unsigned, because history does not always arrive in order — a batch played
 * back out of sequence should not group on the strength of a negative gap.
 */
function minutesApart(a: string, b: string): number {
  const first = Date.parse(a)
  const second = Date.parse(b)
  if (Number.isNaN(first) || Number.isNaN(second)) return Infinity
  return Math.abs(second - first) / 60000
}
