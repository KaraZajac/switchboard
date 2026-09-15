/**
 * The addresses a network can be reached at.
 *
 * Every mainstream client keeps a list per network and falls through it: a
 * server goes down, or a round-robin name points somewhere that is not
 * answering, and the client tries the next one instead of sitting there
 * retrying the same dead address for ever. Switchboard stored exactly one.
 *
 * Written as `host`, `host:6667`, or `host:+6697` — the leading `+` for TLS is
 * the convention mIRC and HexChat use and what people already have in their
 * notes. A port written without one is plain, for the same reason: that is
 * what the convention means, and without it there is no way to write "this
 * one is not encrypted" on a network whose primary is. A bare hostname
 * inherits both from the network. IPv6 goes in brackets: `[2001:db8::1]:6697`.
 */

export interface Address {
  host: string
  port: number
  tls: boolean
}

/**
 * Read one written address.
 *
 * `fallback` supplies what was left out, which is the network's own setting —
 * so a bare hostname in the list inherits the port and TLS you already chose
 * rather than guessing 6667.
 */
export function parseAddress(text: string, fallback: Omit<Address, 'host'>): Address | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null

  // `[::1]:6697`, where the colons in the host are not separators
  const bracketed = trimmed.match(/^\[([^\]]+)\](?::(\+?)(\d+))?$/)
  if (bracketed) {
    const [, host, secure, port] = bracketed
    if (!port) return { host, port: fallback.port, tls: fallback.tls }
    return { host, port: Number(port), tls: secure === '+' }
  }

  // A bare IPv6 address has more than one colon and no port
  if ((trimmed.match(/:/g)?.length ?? 0) > 1) {
    return { host: trimmed, port: fallback.port, tls: fallback.tls }
  }

  const [host, portPart] = trimmed.split(':')
  if (!host) return null
  if (portPart === undefined) return { host, port: fallback.port, tls: fallback.tls }

  const secure = portPart.startsWith('+')
  const port = Number(secure ? portPart.slice(1) : portPart)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null

  return { host, port, tls: secure }
}

/**
 * Every address to try, in order, starting with the network's own.
 *
 * Duplicates are dropped: somebody listing the primary again should not make
 * it come round twice as often.
 */
export function addressesFor(config: {
  host: string
  port: number
  tls: boolean
  altAddresses?: string[]
}): Address[] {
  const first: Address = { host: config.host, port: config.port, tls: config.tls }
  const out = [first]
  const seen = new Set([key(first)])

  for (const written of config.altAddresses ?? []) {
    const address = parseAddress(written, { port: config.port, tls: config.tls })
    if (!address || seen.has(key(address))) continue
    seen.add(key(address))
    out.push(address)
  }

  return out
}

/**
 * Which address a given attempt should use.
 *
 * Round-robin rather than "give up at the end of the list": a network that is
 * wholly down is retried on a backoff anyway, and coming back round to the
 * primary is how a client notices it has returned.
 */
export function addressForAttempt(
  config: { host: string; port: number; tls: boolean; altAddresses?: string[] },
  attempt: number
): Address {
  const all = addressesFor(config)
  const index = attempt <= 0 ? 0 : attempt % all.length
  return all[index]
}

/** How an address is written back out, for a settings field or a log line */
export function formatAddress(address: Address, fallback?: Omit<Address, 'host'>): string {
  const host = address.host.includes(':') ? `[${address.host}]` : address.host
  if (fallback && address.port === fallback.port && address.tls === fallback.tls) return host
  return `${host}:${address.tls ? '+' : ''}${address.port}`
}

const key = (a: Address): string => `${a.host.toLowerCase()}:${a.port}:${a.tls}`
