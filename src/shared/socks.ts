/**
 * SOCKS, by hand.
 *
 * IRC and proxies go together: a bouncer behind a jump host, a network only
 * reachable over Tor, a client that should not show a home address to a
 * channel full of strangers. The settings screen has asked for a proxy since
 * the beginning and nothing read the answer, so this is the part that was
 * missing rather than a new idea.
 *
 * Written out rather than taken from a package because it is eighty lines of
 * well-specified bytes that both clients need, and a Kotlin translation of a
 * dependency is not a thing you can have. Checked against
 * `tests/fixtures/socks.json` so the two agree byte for byte.
 *
 * SOCKS5 is RFC 1928, its username/password authentication RFC 1929. SOCKS4a
 * is the older extension that added names; plain SOCKS4 cannot carry one and
 * is not offered, because resolving the name locally is exactly what a proxy
 * is often there to avoid.
 */

/** What a proxy can be, as stored */
export type ProxyKind = 'none' | 'socks5' | 'socks4'

export interface ProxySettings {
  type: ProxyKind
  host: string
  port: string | number
  username?: string
  password?: string
}

/** Whether these settings name a proxy we should actually dial through */
export function proxyInUse(proxy: ProxySettings | null | undefined): boolean {
  if (!proxy) return false
  if (proxy.type !== 'socks5' && proxy.type !== 'socks4') return false
  return proxy.host.trim().length > 0 && Number(proxy.port) > 0
}

// ── SOCKS5 ───────────────────────────────────────────────────────────

export const AUTH_NONE = 0x00
export const AUTH_USERPASS = 0x02
/** The server's way of saying it accepts none of what we offered */
export const AUTH_REJECTED = 0xff

/**
 * The opening hello, listing what authentication we can do.
 *
 * "No authentication" is always offered: most proxies want none, and a proxy
 * that does want a password will pick the other one.
 */
export function socks5Greeting(hasCredentials: boolean): Uint8Array {
  const methods = hasCredentials ? [AUTH_NONE, AUTH_USERPASS] : [AUTH_NONE]
  return Uint8Array.from([0x05, methods.length, ...methods])
}

/**
 * Which method the proxy chose.
 *
 * Returns null while the two bytes have not both arrived — a proxy is free to
 * send them in separate packets, and a reader that assumes otherwise works
 * every time until it does not.
 */
export function readSocks5Choice(reply: Uint8Array): number | null {
  if (reply.length < 2) return null
  if (reply[0] !== 0x05) return AUTH_REJECTED
  return reply[1]
}

/** RFC 1929: a username and password, each length-prefixed */
export function socks5AuthRequest(username: string, password: string): Uint8Array {
  const user = utf8(username)
  const pass = utf8(password)
  if (user.length > 255 || pass.length > 255) {
    throw new Error('SOCKS5 username and password may each be at most 255 bytes')
  }
  return Uint8Array.from([0x01, user.length, ...user, pass.length, ...pass])
}

/** Whether the proxy accepted the password. Null while still arriving. */
export function readSocks5AuthReply(reply: Uint8Array): boolean | null {
  if (reply.length < 2) return null
  return reply[1] === 0x00
}

/**
 * "Connect me to this host and port."
 *
 * The host goes as a name, not an address, so the proxy resolves it. That is
 * the whole point over Tor — a local lookup for `irc.example.onion` fails, and
 * for an ordinary host it tells the network you are about to connect where a
 * proxy was supposed to hide that.
 */
export function socks5Connect(host: string, port: number): Uint8Array {
  const name = utf8(host)
  if (name.length === 0 || name.length > 255) {
    throw new Error('SOCKS5 host must be 1-255 bytes')
  }
  return Uint8Array.from([
    0x05,
    0x01, // CONNECT
    0x00, // reserved
    0x03, // address is a domain name
    name.length,
    ...name,
    (port >> 8) & 0xff,
    port & 0xff
  ])
}

/** What each SOCKS5 failure code means, in words someone can act on */
export const SOCKS5_ERRORS: Record<number, string> = {
  0x01: 'The proxy failed',
  0x02: 'The proxy refused the connection by its own rules',
  0x03: 'The network is unreachable from the proxy',
  0x04: 'The host is unreachable from the proxy',
  0x05: 'The server refused the connection',
  0x06: 'The connection through the proxy timed out',
  0x07: 'The proxy does not support this kind of connection',
  0x08: 'The proxy does not support this kind of address'
}

export interface SocksReply {
  /** Null while the reply is still arriving */
  ok: boolean | null
  error?: string
  /** How many bytes the reply took, so anything after it is server data */
  length?: number
}

/**
 * The answer to CONNECT.
 *
 * Variable length, because it echoes a bound address whose size depends on its
 * type — and the byte after it is already the IRC server talking, so the
 * length matters rather than being a detail.
 */
export function readSocks5Reply(reply: Uint8Array): SocksReply {
  if (reply.length < 5) return { ok: null }
  if (reply[0] !== 0x05) return { ok: false, error: 'Not a SOCKS5 proxy' }

  const addressType = reply[3]
  const addressLength =
    addressType === 0x01 ? 4 : addressType === 0x04 ? 16 : addressType === 0x03 ? reply[4] + 1 : -1
  if (addressLength < 0) return { ok: false, error: 'The proxy answered with an address we cannot read' }

  const length = 4 + addressLength + 2
  if (reply.length < length) return { ok: null }

  const status = reply[1]
  if (status !== 0x00) {
    return { ok: false, error: SOCKS5_ERRORS[status] ?? `The proxy refused the connection (${status})`, length }
  }
  return { ok: true, length }
}

// ── SOCKS4a ──────────────────────────────────────────────────────────

/**
 * SOCKS4a CONNECT.
 *
 * The 0.0.0.x address is the flag: an address in that range is impossible, so
 * a SOCKS4a proxy reads it as "the name follows". A plain SOCKS4 proxy will
 * try to connect to 0.0.0.1 and fail, which is the correct outcome — better
 * than resolving the name here and quietly leaking the lookup.
 */
export function socks4Connect(host: string, port: number, username = ''): Uint8Array {
  const user = utf8(username)
  const name = utf8(host)
  if (name.length === 0 || name.length > 255) {
    throw new Error('SOCKS4a host must be 1-255 bytes')
  }
  return Uint8Array.from([
    0x04,
    0x01, // CONNECT
    (port >> 8) & 0xff,
    port & 0xff,
    0x00,
    0x00,
    0x00,
    0x01, // 0.0.0.1 — "the hostname is at the end"
    ...user,
    0x00,
    ...name,
    0x00
  ])
}

/** What each SOCKS4 failure code means */
export const SOCKS4_ERRORS: Record<number, string> = {
  0x5b: 'The proxy refused the connection',
  0x5c: 'The proxy could not reach an identd on this machine',
  0x5d: 'The proxy did not recognise the user name'
}

/** The answer to a SOCKS4 CONNECT: always eight bytes */
export function readSocks4Reply(reply: Uint8Array): SocksReply {
  if (reply.length < 8) return { ok: null }
  if (reply[1] === 0x5a) return { ok: true, length: 8 }
  return {
    ok: false,
    error: SOCKS4_ERRORS[reply[1]] ?? `The proxy refused the connection (${reply[1]})`,
    length: 8
  }
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}
