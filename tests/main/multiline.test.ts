import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { parseMultilineLimits, splitForLimits } from '../../src/main/irc/features/multiline'
import { combineMultiline } from '../../src/main/irc/features/batch'

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
