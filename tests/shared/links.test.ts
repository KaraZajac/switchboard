import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { findLinks, safeExternalUrl } from '../../src/shared/links'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/links.json'), 'utf8')) as {
  cases: { name: string; text: string; links: string[] }[]
  safe: { name: string; value: string; url: string | null }[]
}

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

/**
 * Which links we will hand to the operating system.
 *
 * A profile's homepage is a metadata key, so the string came from a stranger,
 * and both `shell.openExternal` and an ACTION_VIEW intent will attempt
 * whatever scheme they are given. This is the list of what we are willing to
 * attempt, and it is short on purpose.
 */
describe('links we are willing to open', () => {
  for (const c of corpus.safe) {
    it(c.name, () => expect(safeExternalUrl(c.value)).toBe(c.url))
  }

  it('refuses nothing at all', () => {
    expect(safeExternalUrl(null)).toBe(null)
    expect(safeExternalUrl(undefined)).toBe(null)
  })

  /**
   * The linkifier and this do not have to agree, but where they disagree it
   * must be this one that is stricter — never the other way round.
   */
  it('is never more permissive than the linkifier', () => {
    for (const found of findLinks('http://a.example https://b.example ftp://c.example')) {
      const safe = safeExternalUrl(found.url)
      if (safe !== null) expect(found.url.startsWith('http')).toBe(true)
    }
  })
})
