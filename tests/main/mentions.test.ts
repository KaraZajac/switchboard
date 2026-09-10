import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { namesYou } from '@shared/mentions'

/**
 * Whether a line is about you.
 *
 * The corpus is shared with the Android suite, because the answer has to be the
 * same on both: a mention that rings the phone and does not colour the desktop
 * is two clients, not one.
 */
const corpus: {
  cases: { name: string; text: string; nick: string; mentions: boolean }[]
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
