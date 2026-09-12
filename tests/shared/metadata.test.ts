import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { metadataToKeep, MAX_METADATA_VALUE } from '@shared/metadata'
import { METADATA_KEYS } from '@shared/types/metadata'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/metadata-keep.json'), 'utf8')
) as {
  cases: { name: string; key: string; value: string; keep: { key: string; value: string } | null }[]
}

/**
 * What a client keeps out of a metadata update.
 *
 * The value is a string a stranger chose, and what a server advertises as its
 * limit is what it will accept rather than what it will pass on. Nothing
 * checked on the way in.
 */
describe('what we keep from a metadata update', () => {
  for (const c of corpus.cases) {
    it(c.name, () => expect(metadataToKeep(c.key, c.value)).toEqual(c.keep))
  }

  it('keeps every key it draws, and only those', () => {
    for (const key of METADATA_KEYS) {
      expect(metadataToKeep(key, 'x')).toEqual({ key, value: 'x' })
    }
    expect(metadataToKeep('', 'x')).toBe(null)
  })

  it('never returns more than the ceiling', () => {
    const kept = metadataToKeep('status', 'a'.repeat(MAX_METADATA_VALUE * 4))
    expect(kept?.value.length).toBe(MAX_METADATA_VALUE)
  })
})
