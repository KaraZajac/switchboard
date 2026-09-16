/**
 * Looking for something that was said, without having to remember where.
 *
 * Search was the last thing in this client that made you name a network first.
 * Direct messages, mentions and friends all stopped being per-network because
 * the question people actually ask is about a person or a phrase, not about a
 * place — and "where did somebody say that?" is the worst possible question to
 * have to answer before you are allowed to ask it.
 *
 * What is shared here is small on purpose: which of two results comes first,
 * and how the place is written. Everything else — how a network's own history
 * is searched, and how the words in a query are matched — is the business of
 * whichever store is answering, and the two stores are not alike.
 */

/** One line somebody said, and enough about where to go back to it */
export interface Found {
  serverId: string
  /** What the network is called here, for reading */
  network: string
  channel: string
  nick: string
  content: string
  timestamp: string
}

/**
 * Where it was said, written the way a person would write it.
 *
 * `#channel@network`, which is the same shape as a friend's `nick@network` —
 * a name and the network it belongs to, because on IRC neither half means
 * anything on its own. `#general` is a different room on every network there
 * is.
 */
export function whereSaid(channel: string, network: string): string {
  return network ? `${channel}@${network}` : channel
}

/**
 * Results from every network as one list, newest first.
 *
 * Time is the only order that means anything across networks: each store has
 * its own idea of how well a line matches, and those numbers are not
 * comparable — a strong match on one network and a weak one on another cannot
 * be sorted against each other without inventing a scale. What somebody
 * remembers instead is roughly when.
 *
 * Ties broken by network then channel, so a run of lines from the same second
 * — a paste, a bot, a netsplit — does not shuffle between searches.
 */
export function newestFirst(found: readonly Found[]): Found[] {
  return [...found].sort((a, b) => {
    const when = b.timestamp.localeCompare(a.timestamp)
    if (when !== 0) return when

    const where = a.network.toLowerCase().localeCompare(b.network.toLowerCase())
    if (where !== 0) return where

    return a.channel.toLowerCase().localeCompare(b.channel.toLowerCase())
  })
}
