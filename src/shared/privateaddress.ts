/**
 * Whether an address is somewhere on this machine or this network.
 *
 * Link previews are fetched by the desktop, for links other people post. That
 * makes "fetch this URL" a thing any stranger in a channel can ask a machine
 * they cannot see to do — and `http://127.0.0.1:8080/` or `http://192.168.1.1/`
 * are URLs. The reply comes back as a title and a description in a preview
 * card, so what is behind the door is partly readable too.
 *
 * The fix is to refuse the destinations that are not on the internet, and to
 * check the address rather than the name: a hostname can resolve wherever its
 * owner likes, which is the whole trick.
 *
 * Ranges from RFC 1918, 3927, 5735, 5737, 6598, 4193 and 4291.
 *
 * This answers about *addresses*. Anything it cannot read as one is refused,
 * which is the safe default here and the wrong answer for a hostname — ask
 * [isIpLiteral] first if the string might be a name.
 */
export function isPrivateAddress(address: string): boolean {
  const host = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  if (host.length === 0) return true

  if (host.includes(':')) return isPrivateIPv6(host)

  const parts = host.split('.')
  if (parts.length !== 4) return true

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return -1
    return Number(part)
  })
  if (octets.some((n) => n < 0 || n > 255)) return true

  const [a, b] = octets

  if (a === 0) return true // this network
  if (a === 10) return true // RFC 1918
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local, and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // RFC 1918
  if (a === 192 && b === 168) return true // RFC 1918
  if (a === 192 && b === 0) return true // IETF protocol assignments, 192.0.0/24 and TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51) return true // TEST-NET-2
  if (a === 203 && b === 0) return true // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a >= 224) return true // multicast, and everything reserved above it

  return false
}

function isPrivateIPv6(host: string): boolean {
  if (host === '::' || host === '::1') return true

  // ::ffff:127.0.0.1 and friends are IPv4 wearing a hat
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return isPrivateAddress(mapped[1])

  const head = host.split(':')[0]
  if (head.length === 0) return true

  const first = parseInt(head, 16)
  if (Number.isNaN(first)) return true

  if ((first & 0xfe00) === 0xfc00) return true // unique local, fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true // link-local, fe80::/10
  if ((first & 0xff00) === 0xff00) return true // multicast

  return false
}

/**
 * Whether this is an address rather than a name.
 *
 * `example.org` is neither private nor public until something resolves it, and
 * handing it to [isPrivateAddress] would have it refused for not parsing. The
 * two questions are different and were briefly the same function.
 */
export function isIpLiteral(host: string): boolean {
  const bare = host.trim().replace(/^\[|\]$/g, '')
  if (bare.length === 0) return false
  if (bare.includes(':')) return true
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(bare)
}

/**
 * An asset URL we are willing to ask a window to load.
 *
 * A page chooses its own preview image and its own favicon, so those are two
 * more URLs a stranger's link gets to point at this machine — `https://
 * 192.168.1.1/x.png` is a valid image URL, and a window told to load it makes
 * the request.
 *
 * The two questions have to be asked in this order. [isPrivateAddress] answers
 * about *addresses* and refuses anything it cannot read as one, which is right
 * there and wrong for a name; asked on its own it called every hostname on the
 * internet private, and the desktop dropped every preview image and every
 * favicon on the way to the window for as long as that guard existed. Link
 * previews were a title and a coloured line, and it read as sites that simply
 * had no picture.
 *
 * Only the literal case is caught, because this runs while building a reply
 * and has no business doing DNS. A name that resolves somewhere private still
 * resolves — it stops the obvious version, which is the one a page would
 * actually try.
 */
export function publicAssetUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (isIpLiteral(parsed.hostname) && isPrivateAddress(parsed.hostname)) return undefined
    return value
  } catch {
    return undefined
  }
}
