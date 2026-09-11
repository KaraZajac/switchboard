import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  parseFormatting,
  formattingAfter,
  stripFormatting,
  readableOnDark,
  IRC_PALETTE,
  mark,
  colourise,
  type FormattedSpan,
  type FormattingMark
} from '../../src/shared/formatting'

interface Case {
  name: string
  text: string
  plain: string
  spans: Partial<FormattedSpan>[]
}

interface Readable {
  name: string
  fg: string | null
  bg: string | null
  out: string | null
}

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/formatting.json'), 'utf8')
) as {
  cases: Case[]
  readable: Readable[]
  carried: { name: string; before: string; text: string; plain: string; spans: Partial<FormattedSpan>[] }[]
  writing: {
    name: string
    text: string
    start: number
    end: number
    mark: string
    result: string
    selectionStart: number
    selectionEnd: number
  }[]
  colour: {
    name: string
    text: string
    start: number
    end: number
    fg: number | null
    bg: number | null
    result: string
  }[]
}

/** The fixture leaves defaults out, so fill them in before comparing */
function expand(span: Partial<FormattedSpan>): FormattedSpan {
  return {
    text: span.text ?? '',
    bold: span.bold ?? false,
    italic: span.italic ?? false,
    underline: span.underline ?? false,
    strikethrough: span.strikethrough ?? false,
    monospace: span.monospace ?? false,
    reverse: span.reverse ?? false,
    fg: span.fg ?? null,
    bg: span.bg ?? null
  }
}

describe('shared formatting corpus', () => {
  it('has a corpus worth running', () => {
    expect(corpus.cases.length).toBeGreaterThan(20)
  })

  for (const c of corpus.cases) {
    it(`parses: ${c.name}`, () => {
      expect(parseFormatting(c.text)).toEqual(c.spans.map(expand))
    })

    it(`strips: ${c.name}`, () => {
      expect(stripFormatting(c.text)).toBe(c.plain)
    })

    it(`keeps offsets usable: ${c.name}`, () => {
      // Everything that measures into a message — links, mention highlights —
      // measures into the stripped text, so the spans have to add up to it
      // exactly. This is the invariant the phone broke.
      expect(parseFormatting(c.text).map((s) => s.text).join('')).toBe(c.plain)
    })
  }

  for (const r of corpus.readable) {
    it(`draws readably: ${r.name}`, () => {
      expect(readableOnDark(r.fg, r.bg)).toBe(r.out)
    })
  }

  for (const c of corpus.carried) {
    it(`carries formatting across a cut: ${c.name}`, () => {
      const carried = formattingAfter(c.before)
      expect(parseFormatting(c.text, carried)).toEqual(c.spans.map(expand))
    })
  }

  it('knows the whole palette', () => {
    expect(IRC_PALETTE).toHaveLength(99)
    expect(IRC_PALETTE[0]).toBe('#ffffff')
    expect(IRC_PALETTE[15]).toBe('#d2d2d2')
    expect(IRC_PALETTE[98]).toBe('#ffffff')
  })
})

/**
 * Producing formatting, not only reading it.
 *
 * Both clients rendered mIRC codes and neither could write one, so bold was
 * something other people's messages had.
 */
describe('writing formatting', () => {
  const writing = corpus.writing
  const colours = corpus.colour

  for (const c of writing) {
    it(c.name, () => {
      const out = mark(c.text, c.start, c.end, c.mark as FormattingMark)
      expect(out.text).toBe(c.result)
      expect(out.selectionStart).toBe(c.selectionStart)
      expect(out.selectionEnd).toBe(c.selectionEnd)
    })
  }

  for (const c of colours) {
    it(c.name, () => {
      expect(colourise(c.text, c.start, c.end, c.fg, c.bg).text).toBe(c.result)
    })
  }

  /**
   * The property that matters: what comes out has to read back as what was
   * asked for. A pair that renders as anything else is worse than no button.
   */
  it('produces formatting the parser reads back', () => {
    const bolded = mark('hello there', 6, 11, 'bold')
    const spans = parseFormatting(bolded.text)
    expect(spans.find((s) => s.text === 'there')?.bold).toBe(true)
    expect(spans.find((s) => s.text === 'hello ')?.bold).toBeFalsy()
  })

  it('round-trips a colour through the parser', () => {
    const red = colourise('danger', 0, 6, 4)
    const spans = parseFormatting(red.text)
    expect(spans[0].text).toBe('danger')
    // The parser resolves a palette index to the colour it renders as
    expect(spans[0].fg).toBe(IRC_PALETTE[4])
  })

  /** Toggling twice is a no-op, or the button lies about what it does */
  it('is its own undo', () => {
    for (const which of ['bold', 'italic', 'underline', 'strikethrough'] as FormattingMark[]) {
      const on = mark('some words here', 5, 10, which)
      const off = mark(on.text, on.selectionStart, on.selectionEnd, which)
      expect(off.text).toBe('some words here')
    }
  })

  /**
   * The padding rule, which is not cosmetic. `\x0341` is a server passing
   * colour 4 followed by the character "1", and a client that writes it
   * unpadded turns the next character of the message into part of the code.
   */
  it('always writes two digits', () => {
    for (let colour = 0; colour < 16; colour++) {
      const out = colourise('x', 0, 1, colour)
      expect(out.text.slice(1, 3)).toMatch(/^\d\d$/)
    }
  })
})
