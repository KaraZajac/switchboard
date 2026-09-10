/**
 * Whether a line says your name.
 *
 * One rule for both clients and for every place either of them asks. The line
 * that rings the phone, the line the badge counts and the line the conversation
 * highlights have to be the same line, or the two devices disagree about what
 * happened while you were looking at the other one.
 *
 * The Kotlin half is `namesYou` in `SwitchboardStore.kt`, and both are checked
 * against `tests/fixtures/mentions.json`.
 */

import { stripFormatting } from './formatting'

/**
 * Characters that count as part of a nick.
 *
 * IRC allows `[]{}\`|^-` in a nickname, so they cannot be word separators the
 * way they are for prose: "kara" appearing inside "kara[work]" is a different
 * person, not a mention. This is the whole reason a plain `\b` will not do —
 * `\b` sits happily between "a" and "[".
 */
const NICK_CHAR = '\\w\\[\\]{}\\\\`|^-'

/** Escape a nick for use inside a regular expression */
const literal = (nick: string): string => nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function namesYou(text: string, nick: string): boolean {
  if (!nick) return false
  // Against the line as it reads. A nick written in colour arrives as
  // `\x0304kara`, and the digit the colour code leaves in front of the name is
  // a word character — so the boundary check failed and being highlighted in
  // red was the one way to not be highlighted at all.
  const said = stripFormatting(text)
  return new RegExp(`(?<![${NICK_CHAR}])${literal(nick)}(?![${NICK_CHAR}])`, 'i').test(said)
}
