import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FormattedText } from '../../src/renderer/components/chat/MessageContent'

/**
 * The formatting, as it actually comes out.
 *
 * Everything under `src/shared` is tested against a corpus, and the corpus
 * proves the parser agrees with the phone's. It says nothing about whether the
 * component that draws the answer renders at all — and this half of the client
 * has never been rendered by anything, only typechecked. A component can
 * typecheck and still throw the moment it is asked for markup.
 *
 * Rendered to a string rather than a DOM, so it needs no jsdom: effects do not
 * run, which is what keeps the IPC calls out of it, and a render-time throw
 * still fails the test.
 */
const html = (node: React.ReactElement): string => renderToStaticMarkup(node)

describe('drawing formatted text', () => {
  it('renders plain text as itself', () => {
    expect(html(<FormattedText text="just talking" />)).toContain('just talking')
  })

  it('renders bold', () => {
    const out = html(<FormattedText text={'\x02loud\x02 quiet'} />)
    expect(out).toContain('font-bold')
    expect(out).toContain('loud')
    expect(out).toContain('quiet')
    expect(out).not.toContain('\x02')
  })

  it('renders strikethrough, which the phone could not draw at all', () => {
    expect(html(<FormattedText text={'\x1egone\x1e'} />)).toContain('line-through')
  })

  it('renders a colour from the palette', () => {
    const out = html(<FormattedText text={'\x0304red'} />)
    expect(out).toContain('#ff0000')
  })

  it('lifts a colour that would vanish into a dark window', () => {
    // Colour 1 is black, which on this background is invisible — worse than
    // no colour, because nothing tells the reader anything was meant
    const out = html(<FormattedText text={'\x0301black'} />)
    expect(out).not.toContain('#000000')
    expect(out).toContain('#737373')
  })

  it('renders the extended palette neither client used to know', () => {
    expect(html(<FormattedText text={'\x0352bright'} />)).toContain('#ff0000')
    expect(html(<FormattedText text={'\x0371pale'} />)).toContain('#59b4ff')
  })

  it('draws reverse video as something rather than nothing', () => {
    // Swapping two unset colours in place used to be a no-op
    const out = html(<FormattedText text={'\x16flipped'} />)
    expect(out).toContain('background-color')
  })

  it('keeps a comma that no digit follows', () => {
    expect(html(<FormattedText text={'\x034,dogs'} />)).toContain(',dogs')
  })

  it('renders a real topic from a real network', () => {
    // Rizon's #news, which both clients used to draw as "13#4N7E8W3S 2- 13|"
    const topic =
      '\x0313#\x034N\x037E\x038W\x033S \x032- \x0313| \x034based \x037ufotable'
    const out = html(<FormattedText text={topic} />)

    expect(out).toContain('#')
    expect(out).toContain('NEWS'.charAt(0))
    expect(out).toContain('based')
    expect(out).not.toContain('13#')
    expect(out).not.toContain('\x03')
  })

  it('highlights a nick without breaking the run it is in', () => {
    const out = html(<FormattedText text="kara: are you there?" highlightNick="kara" />)
    expect(out).toContain('kara')
    expect(out).toContain('are you there?')
  })

  it('carries formatting into a piece that began mid-style', () => {
    const carried = { bold: true, italic: false, underline: false, strikethrough: false,
      monospace: false, reverse: false, fg: null, bg: null }
    expect(html(<FormattedText text=" and more" carried={carried} />)).toContain('font-bold')
  })
})
