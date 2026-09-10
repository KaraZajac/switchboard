import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { dialChanged } from '../../src/shared/dial'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/dial.json'), 'utf8')
) as {
  cases: {
    name: string
    before: Record<string, unknown>
    after: Record<string, unknown>
    redial: boolean
  }[]
}

describe('shared redial corpus', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      expect(dialChanged(c.before, c.after)).toBe(c.redial)
    })
  }
})
