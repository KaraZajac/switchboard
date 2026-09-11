import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { namesYou, saysWatchedWord, mentionsYou } from '@shared/mentions'

/**
 * Whether a line is about you.
 *
 * The corpus is shared with the Android suite, because the answer has to be the
 * same on both: a mention that rings the phone and does not colour the desktop
 * is two clients, not one.
 */
const corpus: {
  cases: { name: string; text: string; nick: string; mentions: boolean }[]
  words: { name: string; text: string; words: string[]; mentions: boolean }[]
} = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/mentions.json'), 'utf8')
)

describe('being named', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      expect(namesYou(c.text, c.nick)).toBe(c.mentions)
    })
  }
})

/**
 * Words you asked to be told about.
 *
 * Read from the same corpus the Android client reads, because the line that
 * rings the phone and the line the badge counts must be the same line — and
 * the two clients decide that separately.
 */
describe('words you watch for', () => {
  const words = corpus.words

  for (const c of words) {
    it(c.name, () => expect(saysWatchedWord(c.text, c.words)).toBe(c.mentions))
  }

  /**
   * The whole point of keeping them in one function. A nick and a watched word
   * are different questions, and nothing downstream should have to ask both.
   */
  it('answers for a nick or a word with one question', () => {
    expect(mentionsYou('kara: hello', 'kara', [])).toBe(true)
    expect(mentionsYou('anyone tried rust?', 'kara', ['rust'])).toBe(true)
    expect(mentionsYou('good morning', 'kara', ['rust'])).toBe(false)
  })

  /**
   * A nick may contain `[]{}\`|^-`, so those cannot be word separators there.
   * A watched word is ordinary prose and they must be — otherwise watching for
   * `build` would miss `the build-server`, which is the thing people mean.
   */
  it('uses prose boundaries, not nick boundaries', () => {
    expect(namesYou('kara[work] said so', 'kara')).toBe(false)
    expect(saysWatchedWord('the build-server is down', ['build'])).toBe(true)
  })
})
