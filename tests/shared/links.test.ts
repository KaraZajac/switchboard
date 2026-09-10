import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { findLinks } from '../../src/shared/links'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/links.json'), 'utf8')
) as { cases: { name: string; text: string; links: string[] }[] }

describe('shared link corpus', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      expect(findLinks(c.text).map((l) => l.url)).toEqual(c.links)
    })
  }

  it('reports where each link is, so a renderer can style exactly that run', () => {
    const text = 'see https://example.com/a. and https://two.example/b'
    for (const link of findLinks(text)) {
      expect(text.slice(link.start, link.end)).toBe(link.url)
    }
  })
})
