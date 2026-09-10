/**
 * Whether an avatar is something we are willing to fetch.
 *
 * An avatar arrives as a metadata key, which means it is a string a stranger
 * typed. Both clients took it and handed it straight to an image loader, and
 * an image loader will attempt whatever it is given: `file:///etc/passwd` on
 * the desktop is a local read started by somebody else's profile, and every
 * `http://` avatar in a four-hundred-person channel is that many strangers
 * learning your address the moment you open the member list.
 *
 * So: https only, and nothing that resolves anywhere but out. That is the same
 * rule browsers apply to mixed content and it costs nothing real — an avatar
 * worth showing is hosted somewhere with a certificate.
 *
 * `data:` is refused as well. It cannot leak anything, but it is unbounded:
 * the metadata value limit is the only thing standing between a channel and a
 * client holding a few hundred megabytes of base64 it was handed.
 */
export function avatarUrl(value: string | null | undefined): string | null {
  if (!value) return null

  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  // A URL long enough to be a problem is not an avatar
  if (trimmed.length > 2048) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:') return null
  // A host is what makes it a fetch rather than a path
  if (parsed.hostname.length === 0) return null

  return parsed.toString()
}
