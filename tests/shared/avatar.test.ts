import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { avatarUrl } from '../../src/shared/avatar'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/avatar.json'), 'utf8')
) as { cases: { name: string; value: string; url: string | null }[] }

describe('shared avatar corpus', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      expect(avatarUrl(c.value)).toBe(c.url)
    })
  }

  it('refuses one long enough to be a denial of service', () => {
    expect(avatarUrl('https://example.net/' + 'a'.repeat(4000))).toBeNull()
  })

  it('takes nothing at all', () => {
    expect(avatarUrl(null)).toBeNull()
    expect(avatarUrl(undefined)).toBeNull()
  })
})
