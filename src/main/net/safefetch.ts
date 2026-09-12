import { net } from 'electron'
import { lookup } from 'dns/promises'
import { isIpLiteral, isPrivateAddress } from '@shared/privateaddress'

/**
 * Fetching a URL somebody else chose.
 *
 * Link previews are the only thing that does this, and the URL comes out of a
 * message — so the person asking this machine to make a request is whoever is
 * in the channel. Three things follow from that, and none of them were true
 * before:
 *
 *  1. **It must not reach this machine or this network.** `http://127.0.0.1:…`
 *     and `http://192.168.1.1/` are ordinary URLs. Checked against the
 *     resolved address rather than the name, because a name resolves wherever
 *     its owner points it.
 *  2. **Every redirect is a new request**, so each hop is checked the same way.
 *     An allowlist on the first URL is no use when the first URL answers 302.
 *  3. **The body is read to a ceiling.** The old code asked for the whole
 *     response and then sliced 32KB off the front, which downloads a gigabyte
 *     to read a title.
 *
 * What comes back is HTML from a stranger. It is scraped for a title and never
 * rendered, which is the only reason picking it apart with regular expressions
 * is acceptable.
 */

/** How many hops to follow before giving up */
const MAX_REDIRECTS = 3

/** How much of the body to read. Metadata lives in the head. */
export const MAX_PREVIEW_BYTES = 32768

/** How long to wait, in total */
const TIMEOUT_MS = 10_000

export class BlockedAddressError extends Error {}

/**
 * Whether we are willing to make this request.
 *
 * Exported for the test, which stubs the resolver.
 */
export async function destinationAllowed(url: URL): Promise<boolean> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  const host = url.hostname
  if (host.length === 0) return false

  // A literal address needs no resolving, and must not be handed to DNS.
  // Only a literal: `isPrivateAddress` refuses anything it cannot read as an
  // address, and a hostname is not one — that is what the resolver is for.
  if (isIpLiteral(host)) return !isPrivateAddress(host)

  let addresses: { address: string }[]
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    // A name that does not resolve is not a fetch worth making
    return false
  }

  if (addresses.length === 0) return false
  // Every answer, not the first: a name that resolves to one public address
  // and one private one is the same trick with a fallback.
  return addresses.every((entry) => !isPrivateAddress(entry.address))
}

export interface FetchedPage {
  /** The first [MAX_PREVIEW_BYTES] of the body, decoded */
  html: string
  /** Where it ended up, for resolving relative URLs against */
  url: string
}

/**
 * Fetch a page for a preview, or refuse.
 *
 * Returns null for anything that is not HTML, and throws
 * [BlockedAddressError] for a destination we will not reach.
 */
export async function fetchForPreview(target: string): Promise<FetchedPage | null> {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return null
  }

  const deadline = Date.now() + TIMEOUT_MS

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await destinationAllowed(url))) throw new BlockedAddressError(url.hostname)

    const left = deadline - Date.now()
    if (left <= 0) return null

    const response = await net.fetch(url.toString(), {
      headers: { 'User-Agent': 'Switchboard IRC Client' },
      // By hand, so every hop is checked. `follow` would make the second
      // request without asking us about it.
      redirect: 'manual',
      signal: AbortSignal.timeout(left)
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return null
      try {
        url = new URL(location, url)
      } catch {
        return null
      }
      continue
    }

    if (!response.ok) return null

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().includes('text/html')) return null

    return { html: await readCapped(response), url: url.toString() }
  }

  // Round and round
  return null
}

/** Read at most [MAX_PREVIEW_BYTES], then stop asking for more. */
async function readCapped(response: Response): Promise<string> {
  const body = response.body
  if (!body) return ''

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let held = 0

  try {
    while (held < MAX_PREVIEW_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(value)
      held += value.length
    }
  } finally {
    // Whatever is left is not being read, and saying so closes the socket
    // rather than leaving the far end streaming into nothing.
    await reader.cancel().catch(() => {})
  }

  const joined = new Uint8Array(held)
  let at = 0
  for (const chunk of chunks) {
    joined.set(chunk, at)
    at += chunk.length
  }

  return new TextDecoder().decode(joined.subarray(0, MAX_PREVIEW_BYTES))
}
