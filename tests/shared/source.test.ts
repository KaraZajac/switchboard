import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isServerSource } from '../../src/shared/source'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/source.json'), 'utf8')
) as { cases: { name: string; prefix: string | null; server: boolean }[] }

describe('shared server-source corpus', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      expect(isServerSource(c.prefix)).toBe(c.server)
    })
  }
})
