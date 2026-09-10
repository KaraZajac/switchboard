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
  return new RegExp(`(?<![${NICK_CHAR}])${literal(nick)}(?![${NICK_CHAR}])`, 'i').test(text)
}
