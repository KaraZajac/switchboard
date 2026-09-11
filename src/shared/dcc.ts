/**
 * DCC — files and chat, directly between two clients.
 *
 * Older than most of IRC and still how most of it moves a file. We have
 * `draft/filehost`, which is the better answer and which almost no network
 * runs; until they do, a file somebody offers you arrives as a DCC SEND and
 * this client had nothing to say about it.
 *
 * The wire format is the part worth writing down carefully. An address is a
 * *32-bit integer in decimal*, not a dotted quad — `3232235777` rather than
 * `192.168.1.1` — which is the single most common thing to get wrong, and
 * getting it wrong means connecting somewhere else entirely. A filename with a
 * space in it is quoted. A port of zero means the sender cannot listen and is
 * asking us to, which is reverse DCC and is how DCC works at all from behind a
 * NAT.
 *
 * Nothing here opens a socket. This is the reading and writing of one line.
 */

export type DccKind = 'send' | 'chat' | 'accept' | 'resume'

export interface DccOffer {
  kind: DccKind
  /** The filename, unquoted. Empty for chat. */
  filename: string
  /** Dotted quad, converted from the integer the protocol uses */
  address: string
  /** Zero means the sender is asking us to listen instead — reverse DCC */
  port: number
  /** Bytes, where the sender said. Zero when unknown. */
  size: number
  /** Reverse DCC pairs an offer with its answer by this */
  token?: string
}

/**
 * Read a DCC line out of a CTCP body.
 *
 * The body is what sits between the delimiters, with the `DCC` verb still on
 * the front — this checks for it rather than assuming.
 */
export function parseDcc(body: string): DccOffer | null {
  const trimmed = body.trim()
  if (!/^DCC\s/i.test(trimmed)) return null

  const rest = trimmed.slice(4).trim()
  const kind = rest.split(/\s+/)[0]?.toLowerCase()
  if (kind !== 'send' && kind !== 'chat' && kind !== 'accept' && kind !== 'resume') return null

  const after = rest.slice(kind.length).trim()
  const [filename, tail] = readFilename(after)
  const parts = tail.split(/\s+/).filter((part) => part.length > 0)

  if (kind === 'chat') {
    // `DCC CHAT chat <address> <port>` — the middle word is always "chat",
    // which `readFilename` has already taken off the front.
    const [address, port] = parts
    if (!address || !port) return null
    return {
      kind,
      filename: '',
      address: addressFrom(address),
      port: Number(port) || 0,
      size: 0
    }
  }

  const [address, port, size, token] = parts
  if (!address || port === undefined) return null

  return {
    kind,
    filename,
    address: addressFrom(address),
    port: Number(port) || 0,
    size: Number(size) || 0,
    ...(token ? { token } : {})
  }
}

/**
 * Write one.
 *
 * The address goes as an integer because that is what the protocol says, and a
 * client that sends a dotted quad is one older clients cannot read.
 */
export function formatDcc(offer: DccOffer): string {
  const address = integerFrom(offer.address)

  if (offer.kind === 'chat') return `DCC CHAT chat ${address} ${offer.port}`

  const name = offer.filename.includes(' ') ? `"${offer.filename}"` : offer.filename
  const tail = offer.token ? ` ${offer.token}` : ''
  return `DCC ${offer.kind.toUpperCase()} ${name} ${address} ${offer.port} ${offer.size}${tail}`
}

/**
 * What to actually call the file on disk.
 *
 * The name comes from whoever sent it, so it is not a name — it is input. A
 * path separator, a parent reference, a leading dot or a device name reserved
 * on Windows all have to be gone before this touches a filesystem.
 */
export function safeFilename(offered: string): string {
  // The last component, whichever separator was used: `../../etc/passwd` and
  // `..\..\windows` are both trying the same thing.
  const base = offered.split(/[/\\]/).pop() ?? ''

  const cleaned = base
    // Control characters, and the punctuation Windows refuses. Built rather
    // than written as a literal: a control character sitting in a regular
    // expression is usually a mistake, and a linter is right to say so.
    .replace(new RegExp(`[${'\\u0000-\\u001f'}<>:"|?*]`, 'g'), '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+/, '')
    .trim()

  if (cleaned.length === 0) return 'received-file'

  // Reserved on Windows whatever the extension, and harmless to avoid
  // everywhere else.
  const stem = cleaned.split('.')[0].toUpperCase()
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/
  return reserved.test(stem) ? `_${cleaned}` : cleaned
}

/**
 * A transfer, as the app follows it.
 *
 * Here rather than beside the socket code, because the window and the phone
 * both display one and neither should have to reach into the main process for
 * the shape of it.
 */
export interface DccTransfer {
  id: string
  /** Who offered it, or who we are sending to */
  peer: string
  serverId: string
  filename: string
  /** Where it is being written, once accepted */
  path?: string
  size: number
  transferred: number
  direction: 'incoming' | 'outgoing'
  state: 'offered' | 'active' | 'done' | 'failed' | 'declined'
  error?: string
  /** The offer as it arrived, for the accept that may come later */
  offer: DccOffer
}

/** Whether this offer is the sender asking us to listen instead */
export function isReverse(offer: DccOffer): boolean {
  return offer.port === 0
}

/**
 * An IPv4 address as the protocol carries it.
 *
 * Anything that is not a plain integer is passed through: IPv6 has no such
 * encoding, and some clients send a dotted quad regardless. Better to try what
 * was sent than to mangle it into something that cannot work at all.
 */
export function addressFrom(value: string): string {
  if (!/^\d+$/.test(value)) return value

  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 0xffffffff) return value

  return [
    (number >>> 24) & 0xff,
    (number >>> 16) & 0xff,
    (number >>> 8) & 0xff,
    number & 0xff
  ].join('.')
}

/** And back, for an offer we are making */
export function integerFrom(address: string): string {
  const parts = address.split('.')
  if (parts.length !== 4) return address

  let number = 0
  for (const part of parts) {
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return address
    number = number * 256 + octet
  }
  return String(number)
}

/**
 * Read a filename off the front, quoted or not.
 *
 * Returns the name and whatever follows it. A quoted name may contain spaces,
 * which is the only reason the quoting exists — and a client that splits on
 * whitespace first reads "my file.txt" as a file called `"my` offered from an
 * address called `file.txt"`.
 */
function readFilename(input: string): [string, string] {
  if (input.startsWith('"')) {
    const end = input.indexOf('"', 1)
    if (end !== -1) return [input.slice(1, end), input.slice(end + 1).trim()]
  }

  const space = input.indexOf(' ')
  if (space === -1) return [input, '']
  return [input.slice(0, space), input.slice(space + 1).trim()]
}
