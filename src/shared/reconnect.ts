/**
 * How long to wait before dialling a server again.
 *
 * The ladder was never the problem. Both clients had a perfectly good
 * exponential backoff and neither ever climbed it, because both reset the
 * attempt counter the moment the **socket** opened rather than when the server
 * actually accepted them:
 *
 *     connectOnce()        // TCP is up
 *     attempt = 0          // ← here
 *     readLoop()           // ERROR :Closing Link ... (Throttled) — goodbye
 *
 * A server that accepts the connection and then closes it — a connect
 * throttle, a full server, a ban, a TLS-only port — is a socket that opens.
 * So the counter went back to zero every single time and the client retried at
 * the base delay for ever. Against `irc.d0ll.link`, which throttles exactly
 * this, that meant a dial every two seconds indefinitely: the client could
 * never escape the throttle, and each attempt refreshed the window keeping it
 * there.
 *
 * The counter now resets on registration. Opening a socket is not being let
 * in; 001 is.
 *
 * And when a server goes to the trouble of saying *why* — that we are
 * reconnecting too fast — the polite answer is not to resume the ladder from
 * the bottom but to wait out the window it is telling us about.
 */

/** First retry. Both clients used to disagree: the desktop 1s, the phone 2s. */
export const RECONNECT_BASE_MS = 2_000

/** The ceiling. A client that gives up entirely is one that silently stops being the connection. */
export const RECONNECT_MAX_MS = 300_000

/**
 * The floor once a server has said we are coming back too fast.
 *
 * Connect throttles are usually measured in tens of seconds, and climbing to
 * that from two would spend four more refused connections getting there — each
 * one refreshing the window that is refusing us.
 */
export const THROTTLED_FLOOR_MS = 60_000

/**
 * Whether the server is telling us to slow down.
 *
 * Real lines, from the ircds that send them — see `tests/fixtures/reconnect.json`.
 * Matched loosely and case-insensitively because every ircd words it
 * differently and none of it is specified anywhere.
 */
const SLOW_DOWN = [
  'reconnecting too fast',
  'trying to reconnect too fast',
  'throttled',
  'too many connections',
  'try again later',
  'rate limit'
]

export function saysSlowDown(text: string | null | undefined): boolean {
  if (!text) return false
  const said = text.toLowerCase()
  return SLOW_DOWN.some((phrase) => said.includes(phrase))
}

/**
 * @param attempt how many attempts have already failed — 1 for the first retry
 * @param lastError what the server said as it closed, if it said anything
 */
export function reconnectDelay(attempt: number, lastError?: string | null): number {
  const step = Math.max(1, attempt)
  const ladder = Math.min(RECONNECT_BASE_MS * Math.pow(2, step - 1), RECONNECT_MAX_MS)
  if (saysSlowDown(lastError)) return Math.max(ladder, THROTTLED_FLOOR_MS)
  return ladder
}
