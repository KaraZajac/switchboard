/**
 * Folding a nick or channel name the way the server does.
 *
 * IRC names are case-insensitive, but not in the way a programming language
 * means it. Which characters are "the same letter" is the server's decision,
 * announced as `CASEMAPPING` in ISUPPORT, and getting it wrong splits one
 * person into two or merges two into one.
 *
 * Two traps, both of which a plain `toLowerCase()` walks straight into:
 *
 * 1. Under `rfc1459` — the default when a server says nothing, which is what
 *    the RFC requires — `[ ] \ ~` are the uppercase forms of `{ } | ^`. They
 *    are common in nicks (`bob[away]`, `n\a`), so treating them as distinct is
 *    not a corner case.
 * 2. `toLowerCase()` folds the whole of Unicode. An `ascii` server folds only
 *    A–Z, so `İ` and `i̇` are two different people to it and one person to us.
 *    That matters here rather than in theory: servers advertising `UTF8ONLY`
 *    accept non-ASCII nicks.
 */

export type Casemapping = 'ascii' | 'rfc1459' | 'rfc1459-strict'

/** A–Z only, leaving every other alphabet alone — which is what servers do */
function asciiLower(name: string): string {
  let out = ''
  for (let at = 0; at < name.length; at++) {
    const code = name.charCodeAt(at)
    out += code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 0x20) : name[at]
  }
  return out
}

/**
 * The mapping named in ISUPPORT, or the default.
 *
 * An unknown name falls back to `rfc1459` rather than to ASCII: it is the
 * conservative reading, since the extra characters it folds are ones a server
 * that named something else is unlikely to treat as distinct.
 */
export function casemappingOf(value: string | true | undefined): Casemapping {
  if (value === 'ascii') return 'ascii'
  if (value === 'rfc1459-strict') return 'rfc1459-strict'
  return 'rfc1459'
}

/** A name as the server would compare it */
export function foldCase(name: string, mapping: Casemapping = 'rfc1459'): string {
  const lowered = asciiLower(name)
  if (mapping === 'ascii') return lowered

  // `~` is uppercase `^` in rfc1459 and not in rfc1459-strict, which is the
  // only difference between the two.
  const extra = mapping === 'rfc1459-strict' ? /[[\]\\]/g : /[[\]\\~]/g
  return lowered.replace(extra, (char) => ({ '[': '{', ']': '}', '\\': '|', '~': '^' })[char] ?? char)
}
