import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { completionsFor, completedDraft } from '../../src/shared/completion'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/completion.json'), 'utf8')
) as {
  matches: { name: string; partial: string; people: string[]; completions: string[] }[]
  suffix: { name: string; draft: string; completion: string; result: string }[]
}

describe('shared completion corpus', () => {
  for (const c of corpus.matches) {
    it(`offers: ${c.name}`, () => {
      expect(completionsFor(c.partial, c.people)).toEqual(c.completions)
    })
  }

  for (const c of corpus.suffix) {
    it(`finishes: ${c.name}`, () => {
      expect(completedDraft(c.draft, c.completion)).toBe(c.result)
    })
  }
})
