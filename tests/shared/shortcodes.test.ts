import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  EMOJI,
  emojiQuery,
  emojiCandidates,
  emojified,
  withShortcodesReplaced,
  type EmojiEntry
} from '../../src/shared/emoji'

/**
 * Emoji by name, the same on both composers: one corpus, a small table of
 * its own so the cases do not move when the real table grows.
 */
const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/shortcodes.json'), 'utf8')) as {
  table: EmojiEntry[]
  query: { name: string; draft: string; query: string | null }[]
  candidates: { name: string; query: string; names: string[] }[]
  completed: { name: string; draft: string; emoji: string; result: string }[]
  replaced: { name: string; text: string; result: string }[]
}

describe('the name being typed', () => {
  for (const c of corpus.query) it(c.name, () => expect(emojiQuery(c.draft)).toBe(c.query))
})

describe('what it could be', () => {
  for (const c of corpus.candidates) {
    it(c.name, () => expect(emojiCandidates(c.query, corpus.table).map((e) => e.name)).toEqual(c.names))
  }
})

describe('picking one', () => {
  for (const c of corpus.completed) it(c.name, () => expect(emojified(c.draft, c.emoji)).toBe(c.result))
})

describe('finished codes on the way out', () => {
  for (const c of corpus.replaced) {
    it(c.name, () => expect(withShortcodesReplaced(c.text, corpus.table)).toBe(c.result))
  }
})

describe('the real table', () => {
  it('has the names people reach for first', () => {
    for (const name of ['smile', 'joy', 'thumbsup', 'heart', 'tada', 'fire', 'eyes', 'shrug']) {
      expect(EMOJI.find((e) => e.name === name), name).toBeDefined()
    }
  })
  it('never lists a name twice', () => {
    expect(new Set(EMOJI.map((e) => e.name)).size).toBe(EMOJI.length)
  })
})
