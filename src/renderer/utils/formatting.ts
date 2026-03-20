/**
 * IRC text formatting parser.
 *
 * Converts mIRC color codes and formatting control characters
 * into structured spans for React rendering.
 *
 * Control codes:
 * \x02 = Bold
 * \x1D = Italic
 * \x1F = Underline
 * \x1E = Strikethrough
 * \x11 = Monospace
 * \x03 = Color (followed by fg[,bg] numbers)
 * \x04 = Hex color
 * \x16 = Reverse (swap fg/bg)
 * \x0F = Reset all formatting
 */

export interface FormattedSpan {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  monospace: boolean
  fg: string | null
  bg: string | null
}

/** Standard mIRC color palette */
const IRC_COLORS: Record<number, string> = {
  0: '#ffffff',
  1: '#000000',
  2: '#00007f',
  3: '#009300',
  4: '#ff0000',
  5: '#7f0000',
  6: '#9c009c',
  7: '#fc7f00',
  8: '#ffff00',
  9: '#00fc00',
  10: '#009393',
  11: '#00ffff',
  12: '#0000fc',
  13: '#ff00ff',
  14: '#7f7f7f',
  15: '#d2d2d2',
  // Extended colors (16-98) would go here
}

/**
 * Parse IRC-formatted text into styled spans.
 */
export function parseIRCFormatting(text: string): FormattedSpan[] {
  const spans: FormattedSpan[] = []
  let current: FormattedSpan = {
    text: '',
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    monospace: false,
    fg: null,
    bg: null
  }

  let i = 0
  while (i < text.length) {
    const char = text.charCodeAt(i)

    switch (char) {
      case 0x02: // Bold
        if (current.text) { spans.push({ ...current }); current = { ...current, text: '' } }
        current.bold = !current.bold
        i++
        break

      case 0x1d: // Italic
        if (current.text) { spans.push({ ...current }); current = { ...current, text: '' } }
        current.italic = !current.italic
        i++
        break

      case 0x1f: // Underline
        if (current.text) { spans.push({ ...current }); current = { ...current, text: '' } }
        current.underline = !current.underline
        i++
        break

      case 0x1e: // Strikethrough
        if (current.text) { spans.push({ ...current }); current = { ...current, text: '' } }
        current.strikethrough = !current.strikethrough
        i++
        break

      case 0x11: // Monospace
        if (current.text) { spans.push({ ...current }); current = { ...current, text: '' } }
        current.monospace = !current.monospace
        i++
        break

      case 0x03: { // Color
        if (current.text) { spans.push({ ...current }); current = { ...current, text: '' } }
        i++

        // Parse foreground color (1-2 digits)
        const fgMatch = text.slice(i).match(/^(\d{1,2})/)
        if (fgMatch) {
          const fgNum = parseInt(fgMatch[1], 10)
          current.fg = IRC_COLORS[fgNum] || null
          i += fgMatch[1].length

          // Parse background color after comma
          if (text[i] === ',') {
            i++
            const bgMatch = text.slice(i).match(/^(\d{1,2})/)
            if (bgMatch) {
              const bgNum = parseInt(bgMatch[1], 10)
              current.bg = IRC_COLORS[bgNum] || null
              i += bgMatch[1].length
            }
          }
        } else {
          // Bare \x03 = reset colors
          current.fg = null
          current.bg = null
        }
        break
      }

      case 0x04: { // Hex color
        if (current.text) { spans.push({ ...current }); current = { ...current, text: '' } }
        i++
        const hexMatch = text.slice(i).match(/^([0-9a-fA-F]{6})/)
        if (hexMatch) {
          current.fg = '#' + hexMatch[1]
          i += 6
          if (text[i] === ',') {
            i++
            const bgHex = text.slice(i).match(/^([0-9a-fA-F]{6})/)
            if (bgHex) {
              current.bg = '#' + bgHex[1]
              i += 6
            }
          }
        }
        break
      }

      case 0x16: { // Reverse
        if (current.text) { spans.push({ ...current }); current = { ...current, text: '' } }
        const temp = current.fg
        current.fg = current.bg
        current.bg = temp
        i++
        break
      }

      case 0x0f: // Reset
        if (current.text) { spans.push({ ...current }) }
        current = {
          text: '',
          bold: false,
          italic: false,
          underline: false,
          strikethrough: false,
          monospace: false,
          fg: null,
          bg: null
        }
        i++
        break

      default:
        current.text += text[i]
        i++
    }
  }

  if (current.text) {
    spans.push(current)
  }

  return spans
}

/**
 * Strip all IRC formatting codes from text.
 */
export function stripIRCFormatting(text: string): string {
  /* eslint-disable no-control-regex */
  return text
    .replace(/\x02|\x1d|\x1f|\x1e|\x11|\x16|\x0f/g, '')
    .replace(/\x03(\d{1,2}(,\d{1,2})?)?/g, '')
    .replace(/\x04([0-9a-fA-F]{6}(,[0-9a-fA-F]{6})?)?/g, '')
  /* eslint-enable no-control-regex */
}
