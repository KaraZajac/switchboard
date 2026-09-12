import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { validServerTime, serverTimeOf } from '@shared/servertime'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/servertime.json'), 'utf8')) as {
  cases: { name: string; value: string | null; valid: string | null }[]
}

/**
 * What a message's `time` tag is allowed to be. Both clients stored it on
 * trust; on the phone it later reached a parser that throws.
 */
describe('what a server-time tag may be', () => {
  for (const c of corpus.cases) {
    it(c.name, () => expect(validServerTime(c.value)).toBe(c.valid))
  }

  it('falls back to the clock, never to the garbage', () => {
    expect(serverTimeOf('soon', () => 'NOW')).toBe('NOW')
    expect(serverTimeOf(undefined, () => 'NOW')).toBe('NOW')
    expect(serverTimeOf('2026-09-12T18:00:00.000Z', () => 'NOW')).toBe('2026-09-12T18:00:00.000Z')
  })
})
