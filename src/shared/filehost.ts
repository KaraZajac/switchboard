/**
 * Sending a file to the network's own filehost.
 *
 * `draft/filehost` is an ISUPPORT token rather than a capability: the network
 * names an HTTP endpoint, a client POSTs the bytes to it, and the reply is the
 * URL to paste into the channel. It is the only file transfer in IRC that
 * works through a NAT, which is to say the only one that works.
 *
 * The desktop has had it since there was a file picker. The phone had nothing
 * at all — no attach button, no upload — which is the wrong way round, because
 * a photograph is on the phone and sharing one is most of what a phone is for.
 */

type Isupport = Record<string, string | true | null | undefined>

/**
 * Where this network takes uploads, or null if it takes none.
 *
 * Both spellings, because the token was renamed when the draft moved and
 * servers are on both sides of that.
 */
export function filehostUrl(isupport: Isupport): string | null {
  const value = isupport['FILEHOST'] ?? isupport['draft/FILEHOST']
  if (typeof value !== 'string' || value.length === 0) return null

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  if (parsed.hostname.length === 0) return null
  return parsed.toString()
}

/**
 * Whether it is safe to prove who we are to this filehost.
 *
 * The upload carries the account password in a Basic header, because that is
 * how the draft says to authenticate. Over plain http that hands the password
 * to anyone on the path — and unlike the IRC connection, which STS and the
 * user's own port choice protect, this URL is whatever the server said.
 *
 * So the credentials go over https and nowhere else. An upload without them
 * either works, because the network allows anonymous uploads, or is refused
 * by the filehost — and being refused is the right outcome for the one where
 * the alternative is giving the password away.
 */
export function mayAuthenticate(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The URL of the file that was just uploaded.
 *
 * The filehost answers 201 with a `Location`, which the draft allows to be
 * relative — and a relative one pasted into a channel is a link to nothing.
 */
export function uploadedUrl(location: string | null | undefined, base: string): string | null {
  const trimmed = location?.trim()
  if (!trimmed) return null

  try {
    const resolved = new URL(trimmed, base)
    // The filehost chose this string and the next thing that happens to it is
    // being pasted into a channel — so it is a link this person publishes to
    // everyone there. `Location: javascript:…` resolves perfectly well and is
    // not a file anybody uploaded.
    if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return null
    return resolved.toString()
  } catch {
    return null
  }
}
