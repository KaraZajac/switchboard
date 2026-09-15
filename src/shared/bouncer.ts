/**
 * Networks a bouncer holds on your behalf.
 *
 * `soju.im/bouncer-networks`. A bouncer stays connected to several networks
 * and a client binds one connection to each, so what a person thinks of as
 * "my networks" lives on the bouncer rather than in this client's own list.
 *
 * The wire form is one `BOUNCER NETWORK <id> <attrs>` per network, attributes
 * separated by `;` and escaped the way IRCv3 escapes tag values. An attribute
 * with no `=` is being *removed*, which is how a bouncer says "this one no
 * longer has a name" — and is why a plain `split('=')` is wrong here.
 */

export interface BouncerNetwork {
  id: string
  /** What to call it. Falls back to the host, which is what soju shows. */
  name: string
  host: string
  port: number
  tls: boolean
  nickname: string
  /** `connected`, `connecting`, `disconnected`, or whatever a bouncer invents */
  state: string
  /** Why it is not connected, when the bouncer says */
  error: string | null
}

/** Attribute values escape `;` and the rest the way IRCv3 escapes tag values */
function unescape(value: string): string {
  return value.replace(/\\(.)/g, (_, char: string) => {
    if (char === ':') return ';'
    if (char === 's') return ' '
    if (char === 'r') return '\r'
    if (char === 'n') return '\n'
    return char
  })
}

/**
 * Read the attribute list off a `BOUNCER NETWORK` line.
 *
 * Returns each attribute and whether it was set or removed, because those mean
 * different things and the caller has to tell them apart.
 */
export function parseAttributes(text: string): Map<string, string | null> {
  const out = new Map<string, string | null>()

  // Split on `;` that is not escaped as `\:`
  for (const piece of text.split(/(?<!\\);/)) {
    if (piece.length === 0) continue
    const at = piece.indexOf('=')
    if (at === -1) {
      // No `=` at all: the bouncer is removing this attribute
      out.set(unescape(piece), null)
      continue
    }
    out.set(unescape(piece.slice(0, at)), unescape(piece.slice(at + 1)))
  }

  return out
}

/**
 * A network, from the attributes a bouncer sent for it.
 *
 * `previous` is what was already known, because a bouncer may send only what
 * changed — `BOUNCER NETWORK 1 state=connected` after the first full listing.
 */
export function networkFrom(
  id: string,
  attributes: Map<string, string | null>,
  previous?: BouncerNetwork
): BouncerNetwork {
  const base: BouncerNetwork = previous ?? {
    id,
    name: '',
    host: '',
    port: 6697,
    tls: true,
    nickname: '',
    state: 'disconnected',
    error: null
  }

  const read = (key: string, fallback: string): string => {
    if (!attributes.has(key)) return fallback
    return attributes.get(key) ?? ''
  }

  const host = read('host', base.host)
  const port = Number(read('port', String(base.port)))

  return {
    id,
    host,
    port: Number.isInteger(port) && port > 0 ? port : base.port,
    tls: attributes.has('tls') ? attributes.get('tls') === '1' : base.tls,
    nickname: read('nickname', base.nickname),
    state: read('state', base.state),
    // A name the bouncer has not given is the host, which is what it shows
    name: read('name', base.name) || host || base.name,
    error: attributes.has('error') ? (attributes.get('error') ?? null) : base.error
  }
}

/** Whether a network line says this one is gone */
export function isRemoval(attributes: Map<string, string | null>): boolean {
  return attributes.has('*')
}

/** The other direction: escape a value so it survives the attribute list */
function escape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\:')
    .replace(/ /g, '\\s')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
}

/**
 * Write an attribute list for a `BOUNCER NETWORK` line.
 *
 * The mirror of `parseAttributes`, for a Switchboard that is *being* the
 * bouncer rather than talking to one. Empty values are dropped rather than
 * sent bare, because an attribute with no `=` means removal — sending
 * `nickname` to say "the nick is empty" would tell the client to forget the
 * nick it has.
 */
export function formatAttributes(attributes: Record<string, string | undefined>): string {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${escape(value as string)}`)
    .join(';')
}

/**
 * Whether the thing we are connected to is a bouncer.
 *
 * It matters for more than display. Switchboard keeps one device on a network
 * at a time, because two connections under one nick collide — but a bouncer is
 * built to multiplex, and holding a desktop off one because a phone is attached
 * gives up the exact thing the bouncer was for.
 *
 * Two signals, either sufficient. `BOUNCER` in ISUPPORT is what soju and
 * Switchboard both advertise; the `soju.im/bouncer-networks` capability is what
 * a bouncer offers when it has networks to hand out. A bouncer that says
 * neither is indistinguishable from a server and is treated as one, which is
 * the safe way round: the cost of being wrong here is a nick collision.
 */
export function isBouncer(
  isupport: Record<string, string | true>,
  capabilities: Iterable<string>
): boolean {
  if ('BOUNCER' in isupport) return true
  for (const capability of capabilities) {
    if (capability === 'soju.im/bouncer-networks') return true
  }
  return false
}

/** The capability a client negotiates to speak this extension at all */
export const BOUNCER_NETWORKS_CAP = 'soju.im/bouncer-networks'

/** And the one that asks to be told when the list changes */
export const BOUNCER_NETWORKS_NOTIFY_CAP = 'soju.im/bouncer-networks-notify'

/**
 * What to send before `CAP END` to land on one of a bouncer's networks.
 *
 * `BOUNCER BIND` is a registration-time command: it has to arrive while
 * negotiation is still open, because the welcome that follows describes the
 * network it bound to — its name, its nick, its limits — and a client reads
 * those once. soju refuses it afterwards with `REGISTRATION_IS_COMPLETED`, and
 * so does Switchboard's own bouncer.
 *
 * Null when there is nothing to bind or nobody to bind with. A network id
 * configured against a server that does not speak the extension is not an
 * error worth failing the connection over — it is an ordinary server, and the
 * connection works, it just lands wherever that server puts it.
 */
export function bindBeforeRegistration(
  netId: string | null | undefined,
  negotiated: Iterable<string>
): string | null {
  const id = netId?.trim()
  if (!id) return null

  for (const cap of negotiated) {
    if (cap === BOUNCER_NETWORKS_CAP) return `BOUNCER BIND ${id}`
  }
  return null
}
