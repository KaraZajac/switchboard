/**
 * Finding the links in a line of text.
 *
 * The two clients each had their own pattern and they disagreed, so the same
 * message produced different links depending on which device you were holding:
 *
 *     desktop  https?://[^\s<>"\])}\x00-\x1f]+
 *     phone    https?://[^\s<>"]+[^\s<>".,!?;:)\]}]
 *
 * The desktop kept the full stop at the end of a sentence inside the URL. The
 * phone dropped it, which is right. Both stopped dead at the first closing
 * bracket, so every Wikipedia link with a disambiguation in it —
 * `.../Mercury_(planet)` — arrived truncated at `(planet`, on both.
 *
 * One rule now, and a better one: run to whitespace, then give back the
 * punctuation that was the sentence's rather than the URL's. A closing bracket
 * is only the sentence's if nothing in the URL opened it, which is what makes
 * `(see https://example.com/a)` and `https://en.wikipedia.org/wiki/Foo_(bar)`
 * both come out whole.
 */

export interface FoundLink {
  url: string
  /** Where it starts in the text, so a renderer can style exactly that run */
  start: number
  end: number
}

/**
 * Schemes worth making clickable.
 *
 * Not a general URL matcher: `www.` without a scheme is ambiguous with
 * ordinary prose, and a client that guesses wrong turns somebody's sentence
 * into a link to nowhere.
 *
 * No word boundary in front of it. A colour code leaves its digits against the
 * scheme — `\x0312https://…` — and a boundary between `2` and `h` is not one,
 * so requiring it meant a bot's coloured link was not a link at all. The cost
 * is matching inside a word that happens to contain a scheme, which nothing
 * writes on purpose and which is harmless when it happens.
 */
const SCHEMES = /(?:https?|ftp):\/\//gi

/** Ends a URL wherever it appears: whitespace and the characters that quote one */
const STOPS = new Set([' ', '\t', '\n', '\r', '<', '>', '"', "'", '`'])

/** Punctuation that ends a sentence rather than a URL */
const TRAILING = new Set(['.', ',', '!', '?', ';', ':', '”', '’'])

const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

export function findLinks(text: string): FoundLink[] {
  const found: FoundLink[] = []
  const scheme = new RegExp(SCHEMES.source, 'gi')

  let match: RegExpExecArray | null
  while ((match = scheme.exec(text)) !== null) {
    const start = match.index

    // Everything up to whitespace or a quoting character. Control bytes end it
    // too: a coloured link arrives as `\x0312https://…\x0f` and the reset byte
    // is not part of the address.
    let end = start
    while (end < text.length) {
      const char = text[end]
      if (STOPS.has(char) || char.charCodeAt(0) < 0x20) break
      end++
    }

    end = trimSentence(text, start, end)

    // A scheme with nothing after it is not a link
    if (end > start + match[0].length) {
      found.push({ url: text.slice(start, end), start, end })
      scheme.lastIndex = end
    }
  }

  return found
}

/**
 * Give back whatever belonged to the sentence rather than to the URL.
 *
 * Repeatedly, because `(https://example.com/a).` ends in two of them and
 * taking one off exposes the other.
 */
function trimSentence(text: string, start: number, end: number): number {
  for (;;) {
    if (end <= start) return end
    const last = text[end - 1]

    if (TRAILING.has(last)) {
      end--
      continue
    }

    const opener = CLOSERS[last]
    if (opener !== undefined && !opens(text, start, end - 1, opener, last)) {
      end--
      continue
    }

    return end
  }
}

/** Whether the URL itself opened this bracket, which makes the closer part of it */
function opens(text: string, start: number, end: number, opener: string, closer: string): boolean {
  let depth = 0
  for (let at = start; at < end; at++) {
    if (text[at] === opener) depth++
    else if (text[at] === closer) depth--
  }
  return depth > 0
}

/**
 * Whether a link is one we are willing to hand to the operating system.
 *
 * Everything here ends up at `shell.openExternal` on the desktop or an
 * `ACTION_VIEW` intent on the phone, and both of those will attempt whatever
 * scheme they are given. That is fine for a link somebody typed in a channel —
 * the linkifier only ever finds `http`, `https` and `ftp` — and not fine at
 * all for a profile's `homepage`, which is a metadata key, which means it is a
 * string a stranger chose. `file:///` reads this machine. On Windows a handler
 * scheme can start a program.
 *
 * So: the two schemes a homepage is ever actually written in, plus `mailto`,
 * because a contact link is a reasonable thing to put in a profile and it
 * opens a composer rather than anything else.
 *
 * `ftp` is deliberately not here even though the linkifier finds it. Nothing
 * modern opens one, and the difference between "the link does nothing" and
 * "the link hands a URL to a program we did not choose" is the whole point.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null

  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 2048) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (!SAFE_SCHEMES.has(parsed.protocol)) return null
  // http and https without a host are not links to anywhere
  if (parsed.protocol !== 'mailto:' && parsed.hostname.length === 0) return null

  return parsed.toString()
}

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:'])
