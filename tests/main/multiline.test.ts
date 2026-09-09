import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { parseMultilineLimits, splitForLimits } from '../../src/main/irc/features/multiline'
import { combineMultiline } from '../../src/main/irc/features/batch'
import { lineBudget, splitToFit } from '../../src/main/irc/features/linelen'

/**
 * draft/multiline, against the corpus the phone reads too.
 *
 * The two clients had already drifted here: the phone honoured
 * `draft/multiline-concat` and the desktop joined everything with a newline,
 * so the same message read differently depending which screen you were at.
 */

const corpus = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/multiline.json'), 'utf8')
)

describe('what the server will accept', () => {
  for (const c of corpus.limits) {
    it(c.name, () => {
      const limits = parseMultilineLimits(c.value)
      expect(limits.maxBytes).toBe(c.maxBytes)
      expect(limits.maxLines).toBe(c.maxLines)
    })
  }
})

describe('splitting a message to fit', () => {
  for (const c of corpus.splits) {
    it(c.name, () => {
      const limits = parseMultilineLimits(c.value)
      expect(splitForLimits(c.lines, limits)).toEqual(c.batches)
    })
  }

  it('never loses or reorders a line', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`)
    const batches = splitForLimits(lines, { maxBytes: 30, maxLines: 4 })

    expect(batches.flat()).toEqual(lines)
    expect(batches.every((b) => b.length <= 4)).toBe(true)
  })
})

describe('putting a received multiline back together', () => {
  for (const c of corpus.concat) {
    it(c.name, () => {
      const parts = c.parts.map((part: { text: string; concat: boolean }) => ({
        tags: part.concat ? { 'draft/multiline-concat': true as const } : {},
        params: ['#lounge', part.text]
      }))

      expect(combineMultiline(parts)).toBe(c.text)
    })
  }

  /** The tag carries no value, and a server may still write it with an empty one */
  it('treats the tag as present however it was written', () => {
    const withValue = [
      { tags: {}, params: ['#lounge', 'one long line that '] },
      { tags: { 'draft/multiline-concat': '' }, params: ['#lounge', 'had to be split'] }
    ]

    expect(combineMultiline(withValue)).toBe('one long line that had to be split')
  })
})

/**
 * Making one line fit on the wire.
 *
 * Over the limit, rIRCd answers `417 :Input line was too long` and delivers
 * nothing — the same shape as the multiline limits, in the place people hit it
 * most often, which is pasting a paragraph.
 */
describe('how much room a message has', () => {
  for (const c of corpus.budget) {
    it(c.name, () => {
      const state = {
        nick: c.nick,
        userHost: c.userHost,
        isupport: c.isupport as Record<string, string | true>
      }
      expect(lineBudget(state, c.command, c.target)).toBe(c.budget)
    })
  }

  /** The guess must never be so tight that splitting cannot terminate */
  it('never returns a budget too small to make progress', () => {
    const state = { nick: 'x'.repeat(400), userHost: null, isupport: {} }
    expect(lineBudget(state, 'PRIVMSG', '#'.repeat(200))).toBeGreaterThan(0)
  })
})

describe('cutting a line to fit', () => {
  for (const c of corpus.split) {
    it(c.name, () => {
      expect(splitToFit(c.text, c.budget)).toEqual(c.pieces)
    })
  }

  /**
   * The property that matters, because these are rejoined with nothing at all
   * on the other side: what comes back has to be character-for-character what
   * was typed.
   */
  it('rejoins to exactly what was typed', () => {
    const text = 'the quick brown fox jumps over the lazy dog '.repeat(20).trim()
    const pieces = splitToFit(text, 40)

    expect(pieces.every((p) => Buffer.byteLength(p, 'utf8') <= 40)).toBe(true)
    expect(pieces.join('')).toBe(text)
  })

  it('rejoins exactly for text with no spaces to break on either', () => {
    const text = 'x'.repeat(500) + '日本語' + 'y'.repeat(200)
    expect(splitToFit(text, 40).join('')).toBe(text)
  })

  /** Whatever the budget, it has to terminate and it has to fit */
  it('always fits, for any budget', () => {
    for (const budget of [1, 2, 3, 7, 33, 512]) {
      const pieces = splitToFit('日本語 mixed ascii and 漢字 text here', budget)
      expect(pieces.length).toBeGreaterThan(0)
      for (const piece of pieces) {
        expect(Buffer.byteLength(piece, 'utf8')).toBeLessThanOrEqual(Math.max(budget, 4))
      }
    }
  })
})
