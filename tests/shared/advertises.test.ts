import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { advertises, isupportNumber } from '../../src/shared/isupport'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/advertises.json'), 'utf8')
) as {
  cases: {
    name: string
    isupport: Record<string, string | true>
    token: string
    advertised: boolean
  }[]
  numbers: {
    name: string
    isupport: Record<string, string | true>
    token: string
    number: number | null
  }[]
}

describe('shared ISUPPORT presence corpus', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      expect(advertises(c.isupport, c.token)).toBe(c.advertised)
    })
  }
})

describe('and the number under either name', () => {
  for (const c of corpus.numbers) {
    it(c.name, () => {
      expect(isupportNumber(c.isupport, c.token)).toBe(c.number)
    })
  }
})
