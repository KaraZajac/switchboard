/**
 * People you would rather not hear from.
 *
 * The one tool every client has had since the eighties and this one did not.
 * `actionsFor` has carried an `ignore` action the whole time with a comment
 * saying it stays out of the menu until there is a list behind it, because a
 * menu item that does nothing is the thing that rule exists to stop. This is
 * the list.
 *
 * An ignore is a mask, not a person: somebody who changes nick is the same
 * person, and `*!*@their.host` still matches. Matching is the same
 * wildcard-against-`nick!user@host` comparison a server does for a ban, with
 * the same case-insensitivity, so what you type here behaves the way the same
 * thing typed into a ban would.
 */

/**
 * What an ignore covers.
 *
 * Deliberately not joins, parts and quits. Those are not only lines on a
 * screen — they are what keeps the member list right — so dropping them makes
 * somebody you ignored linger in the roster after they leave, for good. Hiding
 * them is a rendering decision about everybody rather than a per-person one,
 * which is how every other client treats it too.
 */
export interface IgnoreScope {
  /** Channel messages, private messages, actions and notices */
  messages: boolean
  /** Invitations and CTCP requests */
  requests: boolean
}

export interface IgnoreEntry {
  /** `nick!user@host`, with `*` and `?` wildcards */
  mask: string
  /** Which network, or `*` for everywhere */
  network: string
  scope: IgnoreScope
  /** When it was added, so a list can be ordered by newest */
  added: number
}

export const EVERYWHERE = '*'

/** What ignoring somebody from a menu means, before anybody narrows it */
export const DEFAULT_SCOPE: IgnoreScope = { messages: true, requests: true }

/**
 * Turn what somebody typed into a mask.
 *
 * A bare nick becomes `nick!*@*`, which is what "ignore this person" means to
 * anybody who types it. Anything already carrying mask punctuation is left
 * alone, and a partial one is completed rather than guessed at: `*@host` is
 * plainly about a host and becomes `*!*@host`.
 */
export function toMask(typed: string): string {
  const value = typed.trim()
  if (value.length === 0) return ''

  if (!value.includes('!') && !value.includes('@')) return `${value}!*@*`
  if (!value.includes('!')) {
    // `user@host` or `*@host`
    const [user, ...host] = value.split('@')
    return `*!${user}@${host.join('@')}`
  }
  if (!value.includes('@')) return `${value}@*`
  return value
}

/**
 * Whether a mask matches somebody.
 *
 * `*` is any run of characters and `?` is exactly one, which is what every
 * ircd means by them. Case-insensitive, because IRC is: ignoring `Kara` and
 * then being messaged by `kara` would be a memorable way to fail.
 *
 * A user or host we do not know is treated as unknown rather than empty — on a
 * network without `userhost-in-names`, a roster entry has a nick and nothing
 * else, and matching `*!*@*` against that should still be a match.
 */
export function maskMatches(
  mask: string,
  who: { nick: string; user?: string | null; host?: string | null }
): boolean {
  const target = `${who.nick}!${who.user || '*'}@${who.host || '*'}`
  return globMatches(mask.toLowerCase(), target.toLowerCase())
}

/** Whether this person is ignored on this network, and for what */
export function ignoresFor(
  list: readonly IgnoreEntry[],
  network: string,
  who: { nick: string; user?: string | null; host?: string | null }
): IgnoreEntry[] {
  return list.filter(
    (entry) =>
      (entry.network === EVERYWHERE || entry.network === network) && maskMatches(entry.mask, who)
  )
}

/** Whether anything about this person is ignored at all */
export function isIgnored(
  list: readonly IgnoreEntry[],
  network: string,
  who: { nick: string; user?: string | null; host?: string | null },
  kind: keyof IgnoreScope = 'messages'
): boolean {
  return ignoresFor(list, network, who).some((entry) => entry.scope[kind])
}

/**
 * Add one, replacing any entry for the same mask on the same network.
 *
 * Two entries for one mask cannot both be right, and the newer one is the
 * decision somebody just made.
 */
export function withIgnore(
  list: readonly IgnoreEntry[],
  entry: IgnoreEntry
): IgnoreEntry[] {
  const mask = entry.mask.toLowerCase()
  const rest = list.filter(
    (one) => one.mask.toLowerCase() !== mask || one.network !== entry.network
  )
  return [...rest, entry]
}

/**
 * Take one off.
 *
 * By mask and network, which is what the list shows — removing "whoever
 * matches this person" would take unrelated entries with it.
 */
export function withoutIgnore(
  list: readonly IgnoreEntry[],
  mask: string,
  network: string
): IgnoreEntry[] {
  const wanted = mask.toLowerCase()
  return list.filter((one) => one.mask.toLowerCase() !== wanted || one.network !== network)
}

/**
 * Glob matching, the way an ircd does it.
 *
 * Iterative with a backtrack point rather than recursive: a mask is attacker
 * -supplied in the sense that a nick is, and `*a*a*a*a*a*b` against a long
 * name is the textbook way to make a recursive matcher take a very long time.
 */
function globMatches(pattern: string, value: string): boolean {
  let p = 0
  let v = 0
  let star = -1
  let mark = 0

  while (v < value.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === value[v])) {
      p++
      v++
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p++
      mark = v
    } else if (star !== -1) {
      p = star + 1
      v = ++mark
    } else {
      return false
    }
  }

  while (p < pattern.length && pattern[p] === '*') p++
  return p === pattern.length
}
