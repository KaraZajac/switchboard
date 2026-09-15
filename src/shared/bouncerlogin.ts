/**
 * Which network a client wants, from the name it logs in with.
 *
 * A bouncer holds more than one network, but the client attaching to it speaks
 * plain IRC and has nowhere to say which one it means — there is no field for
 * it in `USER` or `PASS`. The convention every bouncer settled on is to fold it
 * into the username:
 *
 *     kara                  the bouncer itself, no network
 *     kara/netslum          netslum, from this client
 *     kara@laptop           the bouncer, from a client calling itself laptop
 *     kara@laptop/netslum   both
 *
 * This is soju's format, and znc's before it, which is the point: somebody's
 * existing irssi or WeeChat config works unchanged.
 *
 * The client name matters more than it looks. Two clients under one name share
 * a read marker and a backlog position — a phone and a laptop that both call
 * themselves `kara` will each mark the other's messages read. Two different
 * names get their own, which is what somebody with a phone and a laptop
 * actually wants.
 */

export interface BouncerLogin {
  /** The account. Empty when the client sent nothing before the separator. */
  user: string
  /**
   * What this client calls itself, or null for the default.
   *
   * Null and the string `*` mean the same thing, and `*` is what a client that
   * wants the default but has to send something uses.
   */
  client: string | null
  /** The network to bind to, or null to attach to the bouncer itself */
  network: string | null
}

/**
 * Split a login name into its three parts.
 *
 * `@` binds tighter than `/` because the client name comes first: in
 * `kara@laptop/netslum` the client is `laptop`, not `laptop/netslum`. A `@`
 * after the `/` is part of the network name, which is unusual but not ours to
 * refuse — network names are chosen by the person who added them.
 */
export function parseLogin(raw: string): BouncerLogin {
  const slash = raw.indexOf('/')
  const head = slash === -1 ? raw : raw.slice(0, slash)
  const network = slash === -1 ? null : raw.slice(slash + 1)

  const at = head.indexOf('@')
  const user = at === -1 ? head : head.slice(0, at)
  const client = at === -1 ? null : head.slice(at + 1)

  return {
    user,
    client: client === null || client === '' || client === '*' ? null : client,
    network: network === null || network === '' || network === '*' ? null : network
  }
}

/** Put a login back together, for a client that has to be told its own name */
export function formatLogin(login: BouncerLogin): string {
  let out = login.user
  if (login.client) out += `@${login.client}`
  if (login.network) out += `/${login.network}`
  return out
}

/**
 * Match a network the way somebody typing it would expect.
 *
 * Case-insensitive, because nobody types `Libera.Chat` the same way twice, and
 * a login that works from the laptop and fails from the phone over a capital
 * letter is a bad hour. Names are compared with the simple lowercase rule
 * rather than an IRC casemap: these are names the user gave a network in
 * Switchboard, not nicks on a server, so no server's casemapping applies.
 */
export function findNetwork<T>(
  networks: readonly T[],
  wanted: string,
  nameOf: (network: T) => string,
  idOf: (network: T) => string
): T | null {
  // An exact id first: it is unambiguous, and it is what Switchboard's own
  // clients send.
  const byId = networks.find((network) => idOf(network) === wanted)
  if (byId) return byId

  const folded = wanted.toLowerCase()
  const matches = networks.filter((network) => nameOf(network).toLowerCase() === folded)

  // Two networks with the same name is a config somebody should fix, and
  // guessing which one they meant would hide it.
  return matches.length === 1 ? (matches[0] ?? null) : null
}
