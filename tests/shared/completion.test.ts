import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  completionsFor,
  completedDraft,
  mentionQuery,
  mentionCandidates,
  mentioned
} from '../../src/shared/completion'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/completion.json'), 'utf8')
) as {
  matches: { name: string; partial: string; people: string[]; completions: string[] }[]
  suffix: { name: string; draft: string; completion: string; result: string }[]
  mentions: { name: string; draft: string; people: string[]; query: string | null; candidates: string[] }[]
  mentioned: { name: string; draft: string; nick: string; result: string }[]
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

describe('mentions', () => {
  for (const c of corpus.mentions) {
    it(`sees: ${c.name}`, () => {
      expect(mentionQuery(c.draft)).toBe(c.query)
      const query = mentionQuery(c.draft)
      expect(query === null ? [] : mentionCandidates(query, c.people)).toEqual(c.candidates)
    })
  }
  for (const c of corpus.mentioned) {
    it(`finishes: ${c.name}`, () => expect(mentioned(c.draft, c.nick)).toBe(c.result))
  }
})
