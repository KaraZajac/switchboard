import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { carriesTag, tagToUse, TAG_NAMES } from '../../src/shared/clienttags'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/clienttags.json'), 'utf8')
) as {
  carries: { name: string; deny: string | null; tag: string; carried: boolean }[]
  choose: { name: string; deny: string | null; names: string[]; use: string | null }[]
}

describe('shared CLIENTTAGDENY corpus', () => {
  for (const c of corpus.carries) {
    it(c.name, () => {
      expect(carriesTag(c.deny, c.tag)).toBe(c.carried)
    })
  }

  for (const c of corpus.choose) {
    it(`picks a spelling: ${c.name}`, () => {
      expect(tagToUse(c.deny, c.names)).toBe(c.use)
    })
  }

  it('knows both spellings of everything that rides on a tag', () => {
    for (const names of Object.values(TAG_NAMES)) {
      expect(names.length).toBeGreaterThanOrEqual(2)
    }
  })
})
