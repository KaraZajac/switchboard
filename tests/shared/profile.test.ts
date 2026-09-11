import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { resolveProfile, hasOverride, sameProfile, overrideFrom, keysToClear } from '@shared/profile'
import type { UserMetadata } from '@shared/types/metadata'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/profile.json'), 'utf8')) as {
  resolve: { name: string; global: UserMetadata | null; override: UserMetadata | null; result: UserMetadata }[]
  override: { name: string; global: UserMetadata; typed: UserMetadata; stored: UserMetadata | null }[]
  same: { name: string; a: UserMetadata | null; b: UserMetadata | null; same: boolean }[]
  clear: {
    name: string
    keys: string[]
    published: Record<string, string>
    next: Record<string, string>
    result: string[]
  }[]
}

describe('what gets published to one network', () => {
  for (const c of corpus.resolve) {
    it(c.name, () => expect(resolveProfile(c.global, c.override)).toEqual(c.result))
  }

  it('knows whether a network has a profile of its own', () => {
    expect(hasOverride(null)).toBe(false)
    expect(hasOverride({})).toBe(false)
    expect(hasOverride({ 'display-name': 'x' })).toBe(true)
  })
})

describe('what to store against a network', () => {
  for (const c of corpus.override) {
    it(c.name, () => expect(overrideFrom(c.global, c.typed)).toEqual(c.stored))
  }

  /**
   * The property that matters: whatever gets stored, publishing it must give
   * back what the person typed. An override that does not round-trip is one
   * that silently changes what a network is told about you.
   */
  it('round-trips whatever was typed', () => {
    const global = { 'display-name': 'Kara', pronouns: 'she/her' }
    for (const typed of [
      { 'display-name': 'Kara', pronouns: 'she/her' },
      { 'display-name': 'kara@work', pronouns: 'she/her' },
      { 'display-name': 'Kara', pronouns: '' },
      { 'display-name': '', pronouns: '' }
    ]) {
      const stored = overrideFrom(global, typed)
      const published = resolveProfile(global, stored)
      const wanted = Object.fromEntries(
        Object.entries(typed).filter(([, v]) => v.trim().length > 0)
      )
      expect(published).toEqual(wanted)
    }
  })
})

describe('telling a copy from a choice', () => {
  for (const c of corpus.same) {
    it(c.name, () => expect(sameProfile(c.a, c.b)).toBe(c.same))
  }
})

describe('what a network is still wearing that we no longer say', () => {
  for (const c of corpus.clear) {
    it(c.name, () => expect(keysToClear(c.keys, c.published, c.next)).toEqual(c.result))
  }

  /**
   * Clearing is not an operation on its own: publishing what is left and
   * clearing what is not has to leave the network saying exactly the profile,
   * no more and no less. A key in both lists would be set and deleted in the
   * same breath, and which won would be the server's guess.
   */
  it('never clears a key it is also about to set', () => {
    const keys = ['avatar', 'display-name', 'pronouns']
    const published = { avatar: 'a', 'display-name': 'Kara' }
    for (const next of [{}, { avatar: 'b' }, { 'display-name': 'Kara' }, published]) {
      const cleared = keysToClear(keys, published, next)
      for (const key of cleared) expect((next as Record<string, string>)[key] ?? '').toBe('')
    }
  })
})
