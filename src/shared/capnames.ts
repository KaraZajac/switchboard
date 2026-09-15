/**
 * Capabilities that go by more than one name.
 *
 * The IRCv3 process renames things: a draft gets a vendor prefix, or loses
 * one, and for years afterwards two servers offer the same feature under two
 * names. A client that knows only one of them does not fail — it negotiates
 * nothing and the feature is quietly absent, which is the worst shape a bug
 * can have, because everything looks connected.
 *
 * `soju` offers `soju.im/webpush` and Switchboard asked for `draft/webpush`,
 * so push to a phone through a soju has never worked at all, and nothing
 * anywhere said so. That is what this is for.
 *
 * The same idea as `TAG_NAMES` in `@shared/clienttags`, one level up: there it
 * is the spellings of a message tag, here of a capability.
 */

/** Every name we know for each feature, preferred first */
export const CAP_NAMES = {
  /**
   * Asking the server to wake this device when something arrives.
   *
   * `soju.im/webpush` is soju's, and soju is where this matters most — the
   * whole point of a bouncer is being reachable when the client is not.
   */
  webpush: ['draft/webpush', 'soju.im/webpush'],

  /**
   * The server will not send NAMES on joining; ask when you want it.
   *
   * Worth having on a bouncer above all: reattaching to twenty channels sends
   * twenty member lists nobody asked for.
   */
  noImplicitNames: ['no-implicit-names', 'soju.im/no-implicit-names']
} as const

/** Every spelling we are willing to ask for, for the CAP REQ list */
export const CAP_ALIASES: readonly string[] = Object.values(CAP_NAMES).flat()

/**
 * The name this server used, or null if it offered none of them.
 *
 * Returning the name rather than a boolean because the one that was negotiated
 * is the one to use in anything sent afterwards.
 */
export function negotiatedAs(
  negotiated: Iterable<string>,
  names: readonly string[]
): string | null {
  const have = negotiated instanceof Set ? negotiated : new Set(negotiated)
  for (const name of names) {
    if (have.has(name)) return name
  }
  return null
}

/** Whether the server agreed to this feature, under any of its names */
export function hasCapability(negotiated: Iterable<string>, names: readonly string[]): boolean {
  return negotiatedAs(negotiated, names) !== null
}
