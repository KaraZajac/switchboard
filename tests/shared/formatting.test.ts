import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  parseFormatting,
  stripFormatting,
  readableOnDark,
  IRC_PALETTE,
  type FormattedSpan
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
) as { cases: Case[]; readable: Readable[] }

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

  it('knows the whole palette', () => {
    expect(IRC_PALETTE).toHaveLength(99)
    expect(IRC_PALETTE[0]).toBe('#ffffff')
    expect(IRC_PALETTE[15]).toBe('#d2d2d2')
    expect(IRC_PALETTE[98]).toBe('#ffffff')
  })
})
