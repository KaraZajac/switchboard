import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { absenceAction, saysWeAreNotInIt } from '@shared/notonchannel'
import { foldCase } from '@shared/casemap'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/notonchannel.json'), 'utf8')
) as {
  cases: { name: string; numeric: string; channel: string | null; have: string[]; action: string }[]
}

describe('when the server says we are not in a channel', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      const have = new Set(c.have.map(foldCase))
      expect(
        absenceAction(c.numeric, c.channel ?? undefined, (name) => have.has(foldCase(name)))
      ).toBe(c.action)
    })
  }

  it('knows which numerics settle it', () => {
    // Both say, in different words, that we are not in the channel named
    expect(saysWeAreNotInIt('403')).toBe(true)
    expect(saysWeAreNotInIt('442')).toBe(true)
    expect(saysWeAreNotInIt('403 ')).toBe(false)
    expect(saysWeAreNotInIt('473')).toBe(false)
  })
})
