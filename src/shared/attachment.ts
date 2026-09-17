/**
 * What a link actually points at.
 *
 * A URL in a message is one of four things and looks like one thing: a
 * picture to show, a clip to play, a file to offer, or a page to describe.
 * Guessing from the extension gets the first two right most of the time and
 * everything else wrong — `example.org/photo` has no extension and is still a
 * photo, `example.org/index.php?download=1` has the wrong one, and an APK
 * shared from a filehost is `…/f/abc123` with no extension at all.
 *
 * So the server is asked. `Content-Type` is the answer to "what is this", and
 * it is the one the far end is authoritative about; the extension is a guess
 * made before anybody looked. The extension is still the fallback, because a
 * fetch costs a round trip and a `.png` is a `.png`.
 *
 * `page` is the honest answer for "we do not know yet" as well as for a real
 * web page: both are resolved by fetching, and both end up either described
 * with its Open Graph tags or offered as a file.
 */

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file' | 'page'

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv']
const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'oga', 'wav', 'flac', 'm4a', 'opus', 'aac']

/**
 * What to make of a link.
 *
 * `contentType` is what the server said, where anybody has asked it. It wins:
 * a host that says `image/png` for a URL ending in `.txt` is describing its
 * own resource, and a client that argued with it would be wrong.
 */
export function attachmentKind(url: string, contentType?: string | null): AttachmentKind {
  const stated = (contentType ?? '').split(';')[0].trim().toLowerCase()

  if (stated.length > 0) {
    if (stated.startsWith('image/')) return 'image'
    if (stated.startsWith('video/')) return 'video'
    if (stated.startsWith('audio/')) return 'audio'
    // A page is the thing with Open Graph tags in it; everything else that is
    // not media is something to offer rather than to draw.
    if (stated === 'text/html' || stated === 'application/xhtml+xml') return 'page'
    return 'file'
  }

  const extension = extensionOf(url)
  if (extension === null) return 'page'
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image'
  if (VIDEO_EXTENSIONS.includes(extension)) return 'video'
  if (AUDIO_EXTENSIONS.includes(extension)) return 'audio'

  // Not known to be media and nobody has asked the server. Resolving it is
  // what the fetch is for; until then it is a link like any other.
  return 'page'
}

/**
 * What to call the file.
 *
 * The last path segment, which is what a host puts a filename in. Percent
 * escapes are undone because `My%20Report.pdf` is a name somebody typed, and
 * a query string is dropped because `?v=2` is not part of what it is called.
 *
 * Falls back to the host, so a card is never headed with an empty string.
 */
export function attachmentName(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  const segments = parsed.pathname.split('/').filter((part) => part.length > 0)
  const last = segments[segments.length - 1]
  if (!last) return parsed.hostname

  try {
    return decodeURIComponent(last)
  } catch {
    // A stray `%` is not an escape, and a name is better than an exception
    return last
  }
}

/**
 * How big it is, for somebody deciding whether to tap it on mobile data.
 *
 * Powers of 1024 under the names everybody writes — which is what every file
 * manager and every chat client does, and arguing about it on a download
 * button helps nobody. Null where the server did not say, so a card can leave
 * the line out rather than print a confident zero.
 */
export function humanSize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null
  if (bytes < 1024) return `${Math.round(bytes)} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit++
  }
  return `${size.toFixed(2)} ${units[unit]}`
}

/** The lowercased extension, or null where the path has none */
function extensionOf(url: string): string | null {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url.split(/[?#]/)[0]
  }

  const last = pathname.split('/').pop() ?? ''
  const dot = last.lastIndexOf('.')
  if (dot <= 0 || dot === last.length - 1) return null
  return last.slice(dot + 1).toLowerCase()
}
