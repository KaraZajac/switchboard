import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { whereSaid, newestFirst, type Found } from '@shared/search'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/search.json'), 'utf8')) as {
  where: { name: string; channel: string; network: string; label: string }[]
  order: { name: string; found: Found[]; contents: string[] }[]
}

describe('where a line was said', () => {
  for (const c of corpus.where) {
    it(c.name, () => {
      expect(whereSaid(c.channel, c.network)).toBe(c.label)
    })
  }
})

describe('results from every network as one list', () => {
  for (const c of corpus.order) {
    it(c.name, () => {
      expect(newestFirst(c.found).map((f) => f.content)).toEqual(c.contents)
    })
  }

  it('leaves what it was given alone', () => {
    // Sorting in place would reorder whatever the caller is still holding —
    // here, one network's results while the others are still being gathered
    const given: Found[] = [
      { serverId: 's1', network: 'a', channel: '#x', nick: 'n', content: 'old', timestamp: '2026-09-15T10:00:00.000Z' },
      { serverId: 's1', network: 'a', channel: '#x', nick: 'n', content: 'new', timestamp: '2026-09-15T11:00:00.000Z' }
    ]
    newestFirst(given)
    expect(given.map((f) => f.content)).toEqual(['old', 'new'])
  })
})
