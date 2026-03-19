import { describe, it, expect } from 'vitest'
import { parseIRCFormatting, stripIRCFormatting } from '../../src/renderer/utils/formatting'

describe('parseIRCFormatting', () => {
  it('returns plain text as single span', () => {
    const spans = parseIRCFormatting('Hello world')
    expect(spans).toHaveLength(1)
    expect(spans[0].text).toBe('Hello world')
    expect(spans[0].bold).toBe(false)
  })

  it('parses bold text', () => {
    const spans = parseIRCFormatting('\x02bold\x02 normal')
    expect(spans).toHaveLength(2)
    expect(spans[0].text).toBe('bold')
    expect(spans[0].bold).toBe(true)
    expect(spans[1].text).toBe(' normal')
    expect(spans[1].bold).toBe(false)
  })

  it('parses italic text', () => {
    const spans = parseIRCFormatting('\x1Ditalic\x1D')
    expect(spans).toHaveLength(1)
    expect(spans[0].text).toBe('italic')
    expect(spans[0].italic).toBe(true)
  })

  it('parses underline text', () => {
    const spans = parseIRCFormatting('\x1Funderline\x1F')
    expect(spans).toHaveLength(1)
    expect(spans[0].text).toBe('underline')
    expect(spans[0].underline).toBe(true)
  })

  it('parses strikethrough text', () => {
    const spans = parseIRCFormatting('\x1Estrikethrough\x1E')
    expect(spans).toHaveLength(1)
    expect(spans[0].text).toBe('strikethrough')
    expect(spans[0].strikethrough).toBe(true)
  })

  it('parses monospace text', () => {
    const spans = parseIRCFormatting('\x11code\x11')
    expect(spans).toHaveLength(1)
    expect(spans[0].text).toBe('code')
    expect(spans[0].monospace).toBe(true)
  })

  it('parses mIRC foreground color', () => {
    const spans = parseIRCFormatting('\x034red text\x03')
    expect(spans).toHaveLength(1)
    expect(spans[0].text).toBe('red text')
    expect(spans[0].fg).toBe('#ff0000')
  })

  it('parses mIRC foreground and background color', () => {
    const spans = parseIRCFormatting('\x034,2red on blue\x03')
    expect(spans).toHaveLength(1)
    expect(spans[0].text).toBe('red on blue')
    expect(spans[0].fg).toBe('#ff0000')
    expect(spans[0].bg).toBe('#00007f')
  })

  it('parses hex color \\x04', () => {
    const spans = parseIRCFormatting('\x04FF8800orange\x0F')
    expect(spans).toHaveLength(1)
    expect(spans[0].text).toBe('orange')
    expect(spans[0].fg).toBe('#FF8800')
  })

  it('handles reset \\x0F', () => {
    const spans = parseIRCFormatting('\x02bold\x0Fnormal')
    expect(spans).toHaveLength(2)
    expect(spans[0].bold).toBe(true)
    expect(spans[1].bold).toBe(false)
    expect(spans[1].text).toBe('normal')
  })

  it('handles nested formatting (bold + italic)', () => {
    const spans = parseIRCFormatting('\x02\x1Dbold italic\x0F')
    expect(spans).toHaveLength(1)
    expect(spans[0].bold).toBe(true)
    expect(spans[0].italic).toBe(true)
  })

  it('handles reverse \\x16', () => {
    const spans = parseIRCFormatting('\x034,0red on white\x16reversed\x0F')
    expect(spans).toHaveLength(2)
    expect(spans[0].fg).toBe('#ff0000')
    expect(spans[0].bg).toBe('#ffffff')
    // After reverse, fg and bg swap
    expect(spans[1].fg).toBe('#ffffff')
    expect(spans[1].bg).toBe('#ff0000')
  })

  it('returns empty array for empty string', () => {
    const spans = parseIRCFormatting('')
    expect(spans).toHaveLength(0)
  })
})

describe('stripIRCFormatting', () => {
  it('strips all formatting codes', () => {
    expect(stripIRCFormatting('\x02bold\x02 \x034,2colored\x03 \x1Ditalic\x1D'))
      .toBe('bold colored italic')
  })

  it('strips hex colors', () => {
    expect(stripIRCFormatting('\x04FF0000red\x0F')).toBe('red')
  })

  it('passes through plain text unchanged', () => {
    expect(stripIRCFormatting('Hello world')).toBe('Hello world')
  })
})
