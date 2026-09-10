/**
 * Reading the numbers a server states in ISUPPORT.
 *
 * The same shape of problem as the capability values: the server says what it
 * will take, and a client that does not read it finds out by having something
 * refused. The failures differ in kind, which is why they are worth telling
 * apart —
 *
 * - `TARGMAX=PRIVMSG:1` and the message to two people comes back `407 :Too
 *   many recipients`, delivered to neither.
 * - `TOPICLEN=307` and a longer topic is silently cut to 307. Nothing fails;
 *   the user simply finds later that half their sentence is missing.
 */

/** A positive integer from an ISUPPORT token, or null when it said nothing usable */
export function isupportNumber(
  isupport: Record<string, string | true>,
  token: string
): number | null {
  const value = isupport[token]
  if (typeof value !== 'string') return null
  const count = Number(value.trim())
  return Number.isInteger(count) && count > 0 ? count : null
}

/**
 * How many targets one command may carry.
 *
 * `TARGMAX=PRIVMSG:1,NOTICE:4,KICK:` — a name with no number after it means no
 * limit for that command, which is why an empty value cannot be read as zero.
 * Null means the same: send what you like and let the server say otherwise.
 */
export function targetMax(
  isupport: Record<string, string | true>,
  command: string
): number | null {
  const value = isupport['TARGMAX']
  if (typeof value !== 'string') return null

  const wanted = command.toUpperCase()
  for (const entry of value.split(',')) {
    const at = entry.indexOf(':')
    if (at === -1) continue
    if (entry.slice(0, at).trim().toUpperCase() !== wanted) continue

    const count = Number(entry.slice(at + 1).trim())
    return Number.isInteger(count) && count > 0 ? count : null
  }
  return null
}

/**
 * Split a comma-separated target list into groups the server will accept.
 *
 * One group when it stated no limit, which is also what a server that has
 * never heard of TARGMAX gets.
 */
export function groupTargets(targets: string, max: number | null): string[] {
  const names = targets.split(',').map((name) => name.trim()).filter(Boolean)
  if (names.length === 0) return []
  if (max === null || names.length <= max) return [names.join(',')]

  const groups: string[] = []
  for (let at = 0; at < names.length; at += max) {
    groups.push(names.slice(at, at + max).join(','))
  }
  return groups
}

/**
 * Whether text fits a stated maximum, counted the way the server counts.
 *
 * Bytes rather than characters: `TOPICLEN` and its neighbours are byte counts,
 * so a topic in Japanese runs out at a third of the characters an English one
 * does — and a client that measured characters would let it through and watch
 * it get cut.
 */
export function fitsLimit(text: string, limit: number | null): boolean {
  return limit === null || Buffer.byteLength(text, 'utf8') <= limit
}

/**
 * The channel a message was really addressed to.
 *
 * Ops and bots talk to half a room at a time: `PRIVMSG @#channel` reaches
 * everyone with `@` or better, `+#channel` everyone with a voice. Every
 * network I connected to advertises the prefixes it allows — `STATUSMSG=@+` on
 * Libera and OFTC, `~&@%+` on Rizon and Furnet — and neither client looked at
 * the token, so an ops-only line arrived as a conversation called `@#channel`,
 * sitting beside the real one and collecting its own unread count.
 *
 * Returns the channel and the prefix that was on it, so a caller that wants to
 * say who could see the line still can.
 */
export function statusTarget(
  target: string,
  statusmsg: string | true | null | undefined
): { target: string; status: string | null } {
  const allowed = typeof statusmsg === 'string' ? statusmsg : ''
  if (allowed.length === 0 || target.length === 0) return { target, status: null }
  if (!allowed.includes(target[0])) return { target, status: null }
  return { target: target.slice(1), status: target[0] }
}
