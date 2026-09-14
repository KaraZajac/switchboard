import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { nextNickToTry } from '../../src/shared/nicks'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/altnick.json'), 'utf8')) as {
  cases: { name: string; attempted: string; alternatives: string[]; tried: string[]; next: string }[]
}

describe('the nick to try next', () => {
  for (const c of corpus.cases) {
    it(c.name, () => expect(nextNickToTry(c.attempted, c.alternatives, c.tried)).toBe(c.next))
  }
})
