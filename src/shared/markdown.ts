/**
 * The markdown people already type, turned into what IRC understands.
 *
 * `**bold**` and `*italics*` are what everybody writes now, and on IRC they
 * arrive as literal asterisks — so the habit is either unlearned or the
 * channel fills with punctuation. IRC has had real bold and italics since the
 * eighties; they are control bytes rather than characters, which is the only
 * reason nobody types them.
 *
 * So the conversion happens on the way out, not on the way in. A message sent
 * from here is bold *for everybody* — irssi, HexChat, a bouncer's log — rather
 * than bold only for the two people running this client. Rendering it locally
 * and leaving the asterisks on the wire would be the easy way and the wrong
 * one: it makes the sender's screen a lie about what was sent.
 *
 * Spoilers are the exception and are left alone. There is no IRC code for
 * "cover this until asked", so `||…||` stays as text and each client draws it
 * — which degrades, in a client that does not, to a convention people already
 * read as a spoiler.
 */

import { findCommand } from './commandlist'
import { FORMATTING_CODES } from './formatting'

/** What wraps a run, longest first so `***` is not read as `*` twice */
const MARKS: { open: string; code: string }[] = [
  { open: '***', code: FORMATTING_CODES.bold + FORMATTING_CODES.italic },
  { open: '**', code: FORMATTING_CODES.bold },
  { open: '__', code: FORMATTING_CODES.underline },
  { open: '~~', code: FORMATTING_CODES.strikethrough },
  { open: '*', code: FORMATTING_CODES.italic },
  { open: '_', code: FORMATTING_CODES.italic }
]

/** Everything the conversion can produce, for closing a run */
const ALL_CODES = Object.values(FORMATTING_CODES).join('')

/**
 * Whether a character can sit next to a `*` without the `*` meaning anything.
 *
 * `2 * 3 * 4` is arithmetic and `a_b_c` is a name. A mark only opens where
 * what follows it is worth marking, and only closes where what precedes it is
 * — which is the rule every markdown that has survived contact with real text
 * ends up at.
 */
const WORD = /[\p{L}\p{N}]/u

function opens(text: string, at: number, width: number, open: string): boolean {
  const after = text[at + width]
  if (after === undefined || after === ' ' || after === '\t') return false
  // An underscore inside a word is part of the word. `some_file_name` is a
  // name, and every markdown that has met real text ends up at this rule —
  // asterisks do not need it, because nobody writes `some*file*name` and
  // means it literally.
  if (open[0] === '_' && WORD.test(text[at - 1] ?? '')) return false
  return true
}

function closes(text: string, at: number, open: string): boolean {
  const before = text[at - 1]
  if (before === undefined || before === ' ' || before === '\t') return false
  if (open[0] === '_' && WORD.test(text[at + open.length] ?? '')) return false
  return true
}

/**
 * `**bold**` → the bold byte, bold text, and the byte again.
 *
 * Left alone: anything inside backticks, because a run of code means what it
 * says; anything already carrying a control byte, because the composer's own
 * buttons put those there and a message is not marked up twice; a URL, because
 * asterisks are legal in one; and `||spoilers||`, which have no code to become.
 */
export function markdownToIrc(text: string): string {
  // The composer's own bold button has already spoken. Reading the text as
  // markdown as well would nest one inside the other and close the wrong one.
  if ([...ALL_CODES].some((code) => text.includes(code))) return text

  let out = ''
  let i = 0

  while (i < text.length) {
    // A backslash spends itself hiding the next character
    if (text[i] === '\\' && i + 1 < text.length && '*_~`|\\'.includes(text[i + 1])) {
      out += text[i + 1]
      i += 2
      continue
    }

    // Code, spoilers and links pass through whole
    const literal = literalRun(text, i)
    if (literal) {
      out += text.slice(i, i + literal)
      i += literal
      continue
    }

    const mark = MARKS.find(
      (m) => text.startsWith(m.open, i) && opens(text, i, m.open.length, m.open)
    )
    if (mark) {
      const end = closingAt(text, i + mark.open.length, mark.open)
      // Something worth marking has to be inside it. `*!*@host` is a ban mask
      // and `*` around punctuation alone is punctuation — a rule cheap enough
      // to be worth the one case it saves, which is people talking about bans
      // in a channel about IRC.
      if (end !== -1 && WORD.test(text.slice(i + mark.open.length, end))) {
        out += mark.code + markdownToIrc(text.slice(i + mark.open.length, end)) + mark.code
        i = end + mark.open.length
        continue
      }
    }

    out += text[i]
    i += 1
  }

  return out
}

/** How long a run that must not be touched is, or 0 if one does not start here */
function literalRun(text: string, at: number): number {
  if (text.startsWith('||', at)) {
    const end = text.indexOf('||', at + 2)
    if (end !== -1) return end + 2 - at
  }

  if (text[at] === '`') {
    const end = text.indexOf('`', at + 1)
    if (end !== -1) return end + 1 - at
  }

  // A URL, where `*` and `_` are ordinary characters
  const url = /^(?:https?|ircs?):\/\/\S+/.exec(text.slice(at))
  if (url) return url[0].length

  return 0
}

/** Where the run opened at [from] closes, skipping what must not be touched */
function closingAt(text: string, from: number, open: string): number {
  let i = from
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2
      continue
    }

    const literal = literalRun(text, i)
    if (literal) {
      i += literal
      continue
    }

    // A longer mark starting here is that mark, not this one closing early:
    // the `**` inside `***x***` belongs to the run, not to the end of it.
    const longer = MARKS.find((m) => m.open.length > open.length && text.startsWith(m.open, i))
    if (longer) {
      i += longer.open.length
      continue
    }

    if (text.startsWith(open, i) && closes(text, i, open)) return i
    i += 1
  }
  return -1
}

/** What is still marked as a spoiler, for the renderers — see `spoilers` */
export const SPOILER = '||'

/**
 * Split text into runs, saying which are covered.
 *
 * Left to each client to draw, because "covered until asked" is a gesture
 * rather than a colour: a click on the desktop, a tap on the phone.
 */
export function spoilers(text: string): { text: string; hidden: boolean }[] {
  const out: { text: string; hidden: boolean }[] = []
  let i = 0
  let plain = ''

  while (i < text.length) {
    if (text.startsWith(SPOILER, i)) {
      const end = text.indexOf(SPOILER, i + SPOILER.length)
      if (end !== -1) {
        const inside = text.slice(i + SPOILER.length, end)
        // `||||` covers nothing and is four characters somebody typed; and a
        // run that begins or ends with a space is not one either, by the rule
        // the marks use. `if (a || b || c)` is a line of code somebody pasted,
        // and covering ` b ` would hide part of it and eat the bars.
        if (inside.length > 0 && !/^\s|\s$/.test(inside)) {
          if (plain) out.push({ text: plain, hidden: false })
          plain = ''
          out.push({ text: inside, hidden: true })
          i = end + SPOILER.length
          continue
        }
      }
    }
    plain += text[i]
    i += 1
  }

  if (plain) out.push({ text: plain, hidden: false })
  return out
}

/**
 * The markdown in what somebody typed, command and all.
 *
 * A slash command is mostly not prose, and running the conversion over one
 * would be a disaster: `/mode #x +b *!*@host` would come out with the mask
 * italicised and the ban would land on the wrong thing. So the composers used
 * to skip every line beginning with a slash — which is safe, and also meant
 * `/me **waves**` sent the asterisks. Emotes are exactly the place people
 * reach for emphasis.
 *
 * Which commands carry prose is already written down: the catalogue says what
 * each one takes, and the five whose last argument is `<message>` or
 * `<action>` are the five that end in something a person wrote. The count of
 * words before it says how much to step over — one for `/msg <nick> <message>`
 * and none for `/say <message>` — so a target is never touched, and neither is
 * any command the catalogue does not describe this way.
 */
export function markdownForSend(
  typed: string,
  prepare: (prose: string) => string = (prose) => prose
): string {
  const convert = (prose: string): string => markdownToIrc(prepare(prose))
  if (!typed.startsWith('/')) return convert(typed)

  const said = /^\/(\S+)(\s+)([\s\S]+)$/.exec(typed)
  if (!said) return typed
  const [, name, gap, args] = said

  const usage = findCommand(name)?.usage
  if (!usage || !/<(message|action)>$/.test(usage)) return typed

  // `/msg <nick|#channel> <message>` steps over one word, `/say <message>`
  // over none. Whitespace is kept as it was typed rather than rebuilt.
  const skip = usage.trim().split(/\s+/).length - 1
  let at = 0
  for (let word = 0; word < skip; word++) {
    while (at < args.length && !/\s/.test(args[at])) at++
    while (at < args.length && /\s/.test(args[at])) at++
    if (at >= args.length) return typed
  }

  return `/${name}${gap}${args.slice(0, at)}${convert(args.slice(at))}`
}
