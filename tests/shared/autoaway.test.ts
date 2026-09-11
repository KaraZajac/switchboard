import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { awayAction, awayMessage, DEFAULT_AWAY_MESSAGE, type AwayAction } from '@shared/autoaway'

const corpus = JSON.parse(readFileSync(join(__dirname, '../fixtures/autoaway.json'), 'utf8')) as {
  actions: {
    name: string
    idleSeconds: number
    afterMinutes: number
    alreadyAway: boolean
    setByUs: boolean
    action: AwayAction
  }[]
  messages: { name: string; configured: string | null; message: string }[]
}

describe('when to go away', () => {
  for (const c of corpus.actions) {
    it(c.name, () => {
      expect(
        awayAction({
          idleSeconds: c.idleSeconds,
          afterMinutes: c.afterMinutes,
          alreadyAway: c.alreadyAway,
          setByUs: c.setByUs
        })
      ).toBe(c.action)
    })
  }

  /**
   * A setting that was never saved reads back as whatever `Number()` makes of
   * nothing, which is not always zero. Either way it means off.
   */
  it('treats an unreadable setting as off', () => {
    const now = { idleSeconds: 99999, alreadyAway: false, setByUs: false }
    expect(awayAction({ ...now, afterMinutes: Number.NaN })).toBe('nothing')
    expect(awayAction({ ...now, afterMinutes: Number.POSITIVE_INFINITY })).toBe('nothing')
  })

  /** An idle clock that stopped reporting must not be read as never idle either way */
  it('treats an unreadable clock as no time at all', () => {
    expect(
      awayAction({
        idleSeconds: Number.NaN,
        afterMinutes: 10,
        alreadyAway: false,
        setByUs: false
      })
    ).toBe('nothing')
  })
})

describe('what it says', () => {
  for (const c of corpus.messages) {
    it(c.name, () => expect(awayMessage(c.configured)).toBe(c.message))
  }

  it('says the same thing when there is no setting to read', () => {
    expect(awayMessage(undefined)).toBe(DEFAULT_AWAY_MESSAGE)
  })
})
