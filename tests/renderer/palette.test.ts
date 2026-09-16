import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Every colour on screen belongs to the theme.
 *
 * A theme here is not a stylesheet of its own: each one redefines a handful of
 * Tailwind's colour variables, so `text-gray-400` means one thing under Nord
 * and another under Latte, and the whole window changes by changing thirteen
 * lines of CSS. The catch is that Tailwind has hundreds of colours and a theme
 * redefines twenty-two of them. Reach for `text-amber-300` and you have not
 * picked a shade of the palette — you have picked a colour no palette can
 * reach, which stays exactly the same under all thirteen.
 *
 * On the dark twelve that reads as slightly-off. On Catppuccin Latte, the one
 * light theme, it is the difference between a highlight you can read and a
 * highlight at 1.01:1 against its own background, which is what the mention
 * pill measured before this test existed.
 *
 * So: the set of colours a component may name is the set the themes redefine,
 * read out of the stylesheet itself rather than written down twice.
 */

const ROOT = join(__dirname, '../..')
const CSS = readFileSync(join(ROOT, 'src/renderer/styles/globals.css'), 'utf8')

/** The colours every theme redefines, and so the ones a component may use */
const themed = new Set(
  [...CSS.matchAll(/--color-([a-z]+-\d+):/g)].map((match) => match[1])
)

/**
 * Colour names that are not part of any palette and are not meant to be.
 *
 * `white` and `black` are absolutes rather than shades: white on an avatar
 * circle is white on every theme because the circle's colour is the same on
 * every theme. `transparent` and `current` name no colour at all.
 */
const ABSOLUTE = new Set(['white', 'black', 'transparent', 'current', 'inherit'])

/**
 * The one file that means to stand outside the palette.
 *
 * A nick's avatar colour is Tailwind's own `-600` shades, deliberately fixed
 * so that a person is the same colour on every theme and on the phone — and
 * `scripts/themes.py` carries the same list over to Kotlin for exactly that
 * reason. Two of the seventeen (green and indigo) are themed anyway, because
 * every palette redefines those; the note in that script says so.
 */
const OUTSIDE = ['src/renderer/utils/nickColor.ts']

const PALETTES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow',
  'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet',
  'purple', 'fuchsia', 'pink', 'rose'
].join('|')

/** Utilities that paint with a colour, as Tailwind spells them */
const PAINTS =
  'bg|text|border|ring|fill|stroke|from|via|to|decoration|outline|shadow|accent|caret|divide|placeholder'

const USE = new RegExp(`\\b(?:[a-z-]+:)*(?:${PAINTS})-((?:${PALETTES})-\\d{2,3})\\b`, 'g')

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sources(path, found)
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) found.push(path)
  }
  return found
}

describe('the colours the window paints with', () => {
  it('redefines enough of Tailwind to be worth checking against', () => {
    // A sanity check on the regex above rather than on the stylesheet: if this
    // ever reads zero, every other assertion here passes for the wrong reason
    expect(themed.size).toBeGreaterThan(15)
    expect(themed.has('gray-800')).toBe(true)
    expect(themed.has('amber-300')).toBe(false)
  })

  it('names only colours the themes redefine', () => {
    const strays: string[] = []

    for (const path of sources(join(ROOT, 'src/renderer'))) {
      const relative = path.slice(ROOT.length + 1)
      if (OUTSIDE.includes(relative)) continue

      const text = readFileSync(path, 'utf8')
      for (const [, colour] of text.matchAll(USE)) {
        if (themed.has(colour) || ABSOLUTE.has(colour)) continue
        const line = text.slice(0, text.indexOf(colour)).split('\n').length
        strays.push(`${relative}:${line} uses ${colour}`)
      }
    }

    expect(
      [...new Set(strays)].sort(),
      'These colours are the same under all thirteen themes. Use the themed ' +
        'shade of the same meaning — the palette roles are in scripts/themes.py.'
    ).toEqual([])
  })

  /**
   * White is only white where the thing behind it is the same on every theme.
   *
   * Twelve of the thirteen palettes are dark, so `bg-gray-700 text-white` reads
   * everywhere the author looked. Catppuccin Latte is the light one, and it
   * runs the grey scale the other way up: its `gray-700` is `#ccd0da`, so the
   * selected row in the channel list was white text on pale grey at 1.54:1.
   *
   * A heuristic rather than a rule — it looks for the two in one class string,
   * unprefixed, so a `group-hover:text-white` over a `group-hover:bg-green-600`
   * is left alone. Where white is genuinely right the background is not a
   * palette grey: an avatar circle, a black overlay on a picture.
   */
  it('does not put white text on a surface that changes with the theme', () => {
    const offenders: string[] = []

    for (const path of sources(join(ROOT, 'src/renderer'))) {
      const text = readFileSync(path, 'utf8')
      text.split('\n').forEach((line, at) => {
        if (!/(?:^|[\s'"`])text-white\b/.test(line)) return
        if (!/(?:^|[\s'"`])bg-gray-\d{2,3}\b/.test(line)) return
        offenders.push(`${path.slice(ROOT.length + 1)}:${at + 1}`)
      })
    }

    expect(
      offenders.sort(),
      'Use text-gray-100 — the palette says what its own text colour is, and ' +
        'on the light theme a grey surface is pale.'
    ).toEqual([])
  })
})
