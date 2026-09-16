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

import { isupportValue } from './isupport'

type Isupport = Record<string, string | true | null | undefined>

/**
 * Where this network takes uploads, or null if it takes none.
 *
 * Either spelling, because the token keeps its `draft/` prefix until the
 * specification is ratified and servers sit on both sides of that — see
 * `isupportValue`.
 *
 * `overTls` says whether the IRC connection itself is encrypted, and it is not
 * optional in spirit: the spec says a client MUST refuse a plaintext upload
 * URI when the IRC connection is encrypted. The reason is worth stating,
 * because "we already send the password over it" is the wrong way to read it.
 * A user who connected over TLS has said what they expect of this network, and
 * the upload URI is a string that network chose — so a plaintext one is either
 * a misconfiguration or somebody redirecting the files, and in both cases the
 * file and its address go somewhere the user did not agree to.
 *
 * Left defaulting to true because that is the strict answer, and a caller that
 * forgets to say gets the safe behaviour rather than the permissive one.
 */
export function filehostUrl(
  isupport: Isupport,
  options: { overTls?: boolean } = {}
): string | null {
  const value = isupportValue(isupport, 'FILEHOST')
  if (typeof value !== 'string' || value.length === 0) return null

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  if (parsed.hostname.length === 0) return null

  const overTls = options.overTls ?? true
  if (overTls && parsed.protocol !== 'https:') return null

  return parsed.toString()
}

/**
 * The `Content-Disposition` for an upload, with the name intact.
 *
 * Quoting the name and hoping is not enough. A filename on any of these
 * platforms may contain a quote, a backslash or a comma, and the quoted-string
 * form of a header parameter says what to do about it — escape it — which is
 * what stops `my "best" shot.png` arriving as `my `.
 *
 * Anything outside ASCII needs the other form. RFC 6266 says to send both: the
 * plain one for a receiver that only understands that, and `filename*` with a
 * percent-encoded UTF-8 value for one that understands more. Which matters
 * immediately — the first thing anybody uploads from a phone is a photo whose
 * name came from a camera app in their own language.
 *
 * `inline`, following the spec's own example. The difference shows up later,
 * when somebody opens the link: a file sent as `attachment` downloads, and an
 * image posted in a channel should open.
 */
export function contentDisposition(fileName: string): string {
  // A newline here would be a second header and a NUL ends the string in some
  // parsers. Neither can appear in a filename anybody meant to use.
  // eslint-disable-next-line no-control-regex
  const clean = fileName.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'file'

  const plain = asciiOnly(clean)
  const escaped = plain.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const ascii = `inline; filename="${escaped}"`

  // Nothing was lost, so there is nothing for the second form to carry
  if (plain === clean) return ascii

  return `${ascii}; filename*=UTF-8''${encodeRFC5987(clean)}`
}

/**
 * The same name with everything a header cannot carry taken out.
 *
 * A header value is bytes, and both runtimes refuse to send one outside ASCII
 * rather than guessing an encoding — Node throws `ERR_INVALID_CHAR` outright.
 * So a photo named in Greek, Japanese or with an emoji did not upload at all;
 * it failed with a type error from inside the HTTP library, which is not a
 * sentence anybody can act on.
 *
 * The real name still travels, in `filename*`. This is the version for a
 * receiver that reads no further, so it only has to be recognisable and to
 * keep the extension — which is the part that decides how the file is served
 * back and whether it shows in the channel as a picture.
 */
function asciiOnly(name: string): string {
  const stripped = name.replace(/[^\x20-\x7e]/g, '_').replace(/_+/g, '_')

  // Judged on the stem, not the extension: `写真.jpg` keeps a `.jpg` either
  // way, and `_.jpg` is not a name — it is what is left of one.
  const dot = stripped.lastIndexOf('.')
  const stem = dot > 0 ? stripped.slice(0, dot) : stripped
  if (stem.replace(/[_\s]/g, '').length > 0) return stripped

  const extension = dot > 0 ? stripped.slice(dot + 1).replace(/[^a-z0-9]/gi, '') : ''
  return extension ? `file.${extension}` : 'file'
}

/**
 * Percent-encode for the `filename*` form.
 *
 * `encodeURIComponent` leaves `!'()*` alone, and those are not `attr-char` in
 * RFC 5987 — a receiver following the grammar rejects the whole parameter, so
 * a name with an apostrophe in it silently loses its accents everywhere.
 */
function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()!*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

/**
 * Whether this filehost will take a file of this type.
 *
 * From `Accept-Post`, which the spec lets a server return from `OPTIONS` on
 * the upload URI. Asking first is worth one round trip: the alternative is
 * sending a video over a phone connection and being told at the end of it that
 * this network only takes images.
 *
 * A server that says nothing is taken to accept everything, which is what the
 * spec means by MAY — refusing on silence would break every filehost that has
 * not implemented `OPTIONS`.
 */
export function acceptsType(acceptPost: string | null | undefined, contentType: string): boolean {
  const offered = acceptPost?.trim()
  if (!offered) return true

  const type = contentType.split(';')[0]?.trim().toLowerCase()
  if (!type) return false

  for (const raw of offered.split(',')) {
    // `image/*; q=0.8` — the parameters are not part of the match
    const pattern = raw.split(';')[0]?.trim().toLowerCase()
    if (!pattern) continue

    if (pattern === '*/*') return true
    if (pattern === type) return true

    const [group] = pattern.split('/')
    if (pattern.endsWith('/*') && group && type.startsWith(`${group}/`)) return true
  }

  return false
}

/**
 * What to tell somebody whose file was refused before it was sent.
 *
 * Names what the server does take, because "that file type is not allowed" on
 * its own leaves them guessing which of their photos might work.
 */
export function describeAccepted(acceptPost: string | null | undefined): string | null {
  const offered = acceptPost?.trim()
  if (!offered) return null

  const kinds = offered
    .split(',')
    .map((raw) => raw.split(';')[0]?.trim())
    .filter((pattern): pattern is string => !!pattern && pattern !== '*/*')

  return kinds.length > 0 ? kinds.join(', ') : null
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
