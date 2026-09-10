/**
 * mIRC formatting codes, parsed once for both clients.
 *
 * Every IRC client has to undo the same set of in-band control bytes, and the
 * two halves of Switchboard were doing it differently: the desktop rendered
 * colour, strikethrough, reverse video and hex colour, and the phone rendered
 * four of the nine codes and threw the rest away. The same message therefore
 * looked like two different messages depending on which device you picked up,
 * which is the one thing a client that syncs is not allowed to do.
 *
 * The codes, as they appear on the wire:
 *
 * | byte | meaning                                      |
 * |------|----------------------------------------------|
 * | 0x02 | bold                                         |
 * | 0x03 | colour — `NN` or `NN,NN` from the palette     |
 * | 0x04 | colour — `RRGGBB` or `RRGGBB,RRGGBB` in hex   |
 * | 0x0F | reset everything                             |
 * | 0x11 | monospace                                    |
 * | 0x16 | reverse video                                |
 * | 0x1D | italic                                       |
 * | 0x1E | strikethrough                                |
 * | 0x1F | underline                                    |
 *
 * All but the colours are toggles, and none of them are required to be closed
 * before the message ends.
 */

/** The classic sixteen, as mIRC has always drawn them */
const BASE_PALETTE = [
  '#ffffff', '#000000', '#00007f', '#009300', '#ff0000', '#7f0000', '#9c009c', '#fc7f00',
  '#ffff00', '#00fc00', '#009393', '#00ffff', '#0000fc', '#ff00ff', '#7f7f7f', '#d2d2d2'
]

/**
 * The 1999 extension, 16–98.
 *
 * Six bands of twelve hues from near-black to pastel, then eleven greys. Bots
 * reach for these constantly — a feed that colours its source tag `04` and its
 * headline `52` is the normal shape of a busy channel — and a client that only
 * knows the first sixteen draws half the line in the default colour with no
 * sign that anything was meant by it.
 */
const EXTENDED_PALETTE = [
  '#470000', '#472100', '#474700', '#324700', '#004700', '#00472c', '#004747', '#002747',
  '#000047', '#2e0047', '#470047', '#47002a',
  '#740000', '#743a00', '#747400', '#517400', '#007400', '#007449', '#007474', '#004074',
  '#000074', '#4b0074', '#740074', '#740045',
  '#b50000', '#b56300', '#b5b500', '#7db500', '#00b500', '#00b571', '#00b5b5', '#0063b5',
  '#0000b5', '#7500b5', '#b500b5', '#b5006b',
  '#ff0000', '#ff8c00', '#ffff00', '#b2ff00', '#00ff00', '#00ffa0', '#00ffff', '#008cff',
  '#0000ff', '#a500ff', '#ff00ff', '#ff0098',
  '#ff5959', '#ffb459', '#ffff71', '#cfff60', '#6fff6f', '#65ffc9', '#6dffff', '#59b4ff',
  '#5959ff', '#c459ff', '#ff66ff', '#ff59bc',
  '#ff9c9c', '#ffd39c', '#ffff9c', '#e2ff9c', '#9cff9c', '#9cffdb', '#9cffff', '#9cd3ff',
  '#9c9cff', '#dc9cff', '#ff9cff', '#ff94d3',
  '#000000', '#131313', '#282828', '#363636', '#4d4d4d', '#656565', '#818181', '#9f9f9f',
  '#bcbcbc', '#e2e2e2', '#ffffff'
]

/** The full palette, 0–98. 99 is "whatever the client normally uses". */
export const IRC_PALETTE: readonly string[] = [...BASE_PALETTE, ...EXTENDED_PALETTE]

/** A colour code as a hex string, or null for "the default" */
export function paletteColour(index: number): string | null {
  return IRC_PALETTE[index] ?? null
}

export interface FormattedSpan {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  monospace: boolean
  /** Reverse video: the renderer swaps foreground and background */
  reverse: boolean
  fg: string | null
  bg: string | null
}

/** Everything a span carries except the text itself */
export type FormattingState = Omit<FormattedSpan, 'text'>

const BLANK: FormattingState = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  monospace: false,
  reverse: false,
  fg: null,
  bg: null
}

const DIGIT = /[0-9]/
const HEX = /[0-9a-fA-F]/

/**
 * Split formatted text into runs that share one style.
 *
 * Control bytes never appear in the returned text, so the concatenation of
 * every span is exactly what the reader sees — which is what makes it safe to
 * measure offsets against, for links and for mention highlighting.
 */
export function parseFormatting(text: string, initial?: FormattingState): FormattedSpan[] {
  return scan(text, initial).spans
}

/**
 * The style still open at the end of this text.
 *
 * A message is not always parsed in one piece: the desktop pulls links, code
 * blocks and markdown out first and formats what is left between them. Each of
 * those was parsed from nothing, so `\x02bold https://example.com more` lost
 * the bold at the link and never got it back — while the phone, which parses
 * the whole line and finds links inside it, kept it. The same message, two
 * devices, two answers.
 */
export function formattingAfter(text: string, initial?: FormattingState): FormattingState {
  return scan(text, initial).style
}

function scan(
  text: string,
  initial?: FormattingState
): { spans: FormattedSpan[]; style: FormattingState } {
  const spans: FormattedSpan[] = []
  let style = { ...(initial ?? BLANK) }
  let run = ''
  let i = 0

  const flush = (): void => {
    if (run.length === 0) return
    spans.push({ text: run, ...style })
    run = ''
  }

  /** Read up to `max` characters matching `set`, from `i` onwards */
  const digits = (max: number, set: RegExp): string => {
    let out = ''
    while (out.length < max && i < text.length && set.test(text[i])) {
      out += text[i]
      i++
    }
    return out
  }

  while (i < text.length) {
    const code = text.charCodeAt(i)

    switch (code) {
      case 0x02:
        flush(); style.bold = !style.bold; i++
        break
      case 0x1d:
        flush(); style.italic = !style.italic; i++
        break
      case 0x1f:
        flush(); style.underline = !style.underline; i++
        break
      case 0x1e:
        flush(); style.strikethrough = !style.strikethrough; i++
        break
      case 0x11:
        flush(); style.monospace = !style.monospace; i++
        break
      case 0x16:
        flush(); style.reverse = !style.reverse; i++
        break

      case 0x03: {
        flush()
        i++
        const fg = digits(2, DIGIT)
        if (fg === '') {
          // A bare colour byte closes whatever colour was open
          style.fg = null
          style.bg = null
          break
        }
        style.fg = paletteColour(parseInt(fg, 10))
        // The comma only belongs to us when a digit follows it. "\x0304,000
        // received" is a red comma and a number, not a broken background —
        // eating it unconditionally silently deletes a character of someone's
        // sentence.
        if (text[i] === ',' && i + 1 < text.length && DIGIT.test(text[i + 1])) {
          i++
          style.bg = paletteColour(parseInt(digits(2, DIGIT), 10))
        }
        break
      }

      case 0x04: {
        flush()
        i++
        const fg = digits(6, HEX)
        if (fg.length < 6) {
          // Not a colour after all. Anything we consumed was hex digits, so
          // put them back rather than losing them.
          style.fg = null
          style.bg = null
          run += fg
          break
        }
        style.fg = '#' + fg.toLowerCase()
        if (text[i] === ',' && i + 1 < text.length && HEX.test(text[i + 1])) {
          const mark = i
          i++
          const bg = digits(6, HEX)
          if (bg.length === 6) {
            style.bg = '#' + bg.toLowerCase()
          } else {
            i = mark
          }
        }
        break
      }

      case 0x0f:
        flush(); style = { ...BLANK }; i++
        break

      default:
        run += text[i]
        i++
    }
  }

  flush()
  return { spans, style }
}

/**
 * The same text with every control byte removed.
 *
 * Derived from the parser rather than written twice, because the two used to
 * disagree about how much of `\x0304,abc` was a colour code — and the half
 * that got it wrong was the half feeding notifications and search.
 */
export function stripFormatting(text: string): string {
  let out = ''
  for (const span of parseFormatting(text)) out += span.text
  return out
}

/** Whether a span asks for anything at all */
export function isPlain(span: FormattedSpan): boolean {
  return (
    !span.bold &&
    !span.italic &&
    !span.underline &&
    !span.strikethrough &&
    !span.monospace &&
    !span.reverse &&
    span.fg === null &&
    span.bg === null
  )
}

/**
 * How light a colour reads, 0–255.
 *
 * BT.601 weights in integer arithmetic, so the phone and the desktop can never
 * land on different sides of the threshold below.
 */
function lightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return (77 * r + 150 * g + 29 * b) >> 8
}

/** Move a channel `percent` of the way to 255 */
function lift(channel: number, percent: number): number {
  return Math.floor((channel * (100 - percent) + 255 * percent + 50) / 100)
}

/**
 * The darkest a colour may be before it disappears into the window.
 *
 * mIRC's palette was chosen against white. Both Switchboard clients are dark,
 * so colour 1 is black text on a near-black background — invisible, and worse
 * than not colouring it at all, because the reader cannot tell there was ever
 * anything there. This is why the phone stripped colours instead of drawing
 * them; now both sides lift the few colours that need it and keep the rest.
 *
 * Only applies when the sender did not also pick a background: if they chose
 * the pair, they chose it, and we draw what they asked for.
 */
export function readableOnDark(fg: string | null, bg: string | null): string | null {
  if (fg === null || bg !== null) return fg
  if (lightness(fg) >= 64) return fg

  const n = parseInt(fg.slice(1), 16)
  const r = lift((n >> 16) & 0xff, 45)
  const g = lift((n >> 8) & 0xff, 45)
  const b = lift(n & 0xff, 45)
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
}
