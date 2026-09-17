import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { viewingOlder, VIEWING_OLDER, JUMP_TO_PRESENT } from '@shared/present'

/**
 * When to offer a way back to the newest message — see `@shared/present` and
 * the Android `Present`, which this corpus also runs against.
 */
const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/present.json'), 'utf8')) as {
  cases: { name: string; below: number; screen: number; older: boolean }[]
  words: { viewingOlder: string; jumpToPresent: string }
}

describe('whether somebody is reading the past', () => {
  for (const c of corpus.cases) {
    it(c.name, () => expect(viewingOlder(c.below, c.screen)).toBe(c.older))
  }

  it('says it the same way on both clients', () => {
    expect(VIEWING_OLDER).toBe(corpus.words.viewingOlder)
    expect(JUMP_TO_PRESENT).toBe(corpus.words.jumpToPresent)
  })
})
