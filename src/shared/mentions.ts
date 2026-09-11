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

/**
 * Words that should ring the same bell your nick does.
 *
 * Every other client has had these for decades, under one name or another —
 * "highlight words", "keywords", "notify words". Being told only when somebody
 * types your nick means missing the thread about the thing you actually care
 * about, in a channel you are only in for that.
 *
 * Prose boundaries rather than nick boundaries. A nick may contain `[]{}\`|^-`
 * so those cannot separate words there; a highlight word is ordinary English
 * and `rust` should not fire on `trusted`. A phrase with spaces in it is
 * matched whole.
 */
export function saysWatchedWord(text: string, words: readonly string[]): boolean {
  if (words.length === 0) return false
  const said = stripFormatting(text)

  for (const raw of words) {
    const word = raw.trim()
    if (word.length === 0) continue
    // `\b` sits between a word character and anything else, which is exactly
    // right for prose — and wrong for a word that begins or ends with
    // punctuation, where there is no boundary to find. Those match plainly.
    const edged = /^\w/.test(word) ? '\\b' : ''
    const tail = /\w$/.test(word) ? '\\b' : ''
    if (new RegExp(`${edged}${literal(word)}${tail}`, 'i').test(said)) return true
  }
  return false
}

/**
 * The one question both clients ask: is this line for me?
 *
 * Your nick, or anything you said to watch for. Kept as one function so the
 * line that rings the phone, the line the badge counts and the line the
 * conversation highlights cannot come apart.
 */
export function mentionsYou(
  text: string,
  nick: string,
  words: readonly string[] = []
): boolean {
  return namesYou(text, nick) || saysWatchedWord(text, words)
}
