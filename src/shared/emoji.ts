/**
 * Emoji by name.
 *
 * `:smile:` is how Slack, Discord, GitHub and every chat client since has
 * let people type an emoji without leaving the keyboard: a colon, a few
 * letters, pick from the list. IRC has no such thing, so the desktop had no
 * way to type one at all beyond the system's own picker, and the phone only
 * its keyboard's.
 *
 * The table is `emoji.json`, which both clients read — the phone gets a copy
 * in its assets at build time, like the network list. The rules for what a
 * half-typed name matches and what a finished one turns into are here and
 * in `Emoji.kt`, checked against `tests/fixtures/shortcodes.json`.
 */

import table from './emoji.json'

export interface EmojiEntry {
  emoji: string
  /** The shortcode, without its colons */
  name: string
  keywords?: string[]
}

export const EMOJI: EmojiEntry[] = table as EmojiEntry[]

/**
 * A name being typed: a colon at the start of a word and at least two
 * letters after it. Two, so `10:30` and a bare colon stay what they are.
 */
const SHORTCODE = /(?:^|\s):([a-z0-9_+-]{2,})$/i

export function emojiQuery(draft: string): string | null {
  const match = SHORTCODE.exec(draft)
  return match ? match[1] : null
}

/**
 * What a name so far could be. Names that start with it first, in order,
 * then anything whose name or keywords contain it — `happy` finds
 * `smiley` that way, and `+1` finds `thumbsup`.
 */
export function emojiCandidates(
  query: string,
  entries: readonly EmojiEntry[] = EMOJI,
  limit = 8
): EmojiEntry[] {
  const wanted = query.toLowerCase()
  if (wanted.length === 0) return entries.slice(0, limit)
  // Shortest first: `sm` should offer `smile` before `small_orange_diamond`
  const starts = entries
    .filter((entry) => entry.name.startsWith(wanted))
    .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
  const mentions = entries.filter(
    (entry) =>
      !entry.name.startsWith(wanted) &&
      (entry.name.includes(wanted) || (entry.keywords ?? []).some((k) => k.includes(wanted)))
  )
  return [...starts, ...mentions].slice(0, limit)
}

/** The draft with the name being typed replaced by the emoji, and a space to go on */
export function emojified(draft: string, emoji: string): string {
  const match = SHORTCODE.exec(draft)
  if (!match) return draft
  const at = match.index + (match[0].startsWith(':') ? 0 : 1)
  return draft.slice(0, at) + emoji + ' '
}

/**
 * Every finished `:name:` in a line turned into its emoji, on the way out.
 *
 * Only at the start of a word, so a time like `10:30:00` and a path with a
 * colon in it are left alone; and only names the table knows, so a stray
 * `:nope:` stays as typed rather than vanishing.
 */
export function withShortcodesReplaced(text: string, entries: readonly EmojiEntry[] = EMOJI): string {
  return text.replace(/(^|[\s([])(:([a-z0-9_+-]+):)/gi, (whole, before: string, code: string, name: string) => {
    const found = entries.find((entry) => entry.name === name.toLowerCase())
    return found ? before + found.emoji : whole
  })
}
