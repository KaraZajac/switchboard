import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { furthestRead, movesForward } from '@shared/readmarker'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/readmarker.json'), 'utf8')) as {
  cases: {
    name: string
    known: string | null
    arriving: string | null
    furthest: string | null
    forward: boolean
  }[]
}

describe('where a conversation has been read up to', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      expect(furthestRead(c.known, c.arriving)).toBe(c.furthest)
      expect(movesForward(c.known, c.arriving)).toBe(c.forward)
    })
  }
})

describe('the race this exists for', () => {
  it('survives the startup load landing after a channel was read', () => {
    // Read the channel now; the stored copy from last time arrives a moment
    // later and is hours old. Replacing the value here is the bug.
    const readJustNow = '2026-09-16T11:30:00.000Z'
    const fromLastNight = '2026-09-15T23:04:00.000Z'

    expect(furthestRead(readJustNow, fromLastNight)).toBe(readJustNow)
    expect(movesForward(readJustNow, fromLastNight)).toBe(false)
  })

  it('still lets the other device move it on', () => {
    const here = '2026-09-16T09:00:00.000Z'
    const onThePhone = '2026-09-16T11:30:00.000Z'

    expect(furthestRead(here, onThePhone)).toBe(onThePhone)
    expect(movesForward(here, onThePhone)).toBe(true)
  })
})
