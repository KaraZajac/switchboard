import { describe, it, expect } from 'vitest'
import { decide } from '../../src/main/irc/features/autoaway'

/**
 * Going away when the keyboard goes quiet.
 *
 * The rule itself, without the power monitor. The case worth guarding is a
 * missing setting: read as a number it is zero, and "after zero minutes" would
 * mark somebody away the instant they connected.
 */
describe('when to go away', () => {
  it('waits for the whole interval', () => {
    expect(decide(0, 10)).toBe('back')
    expect(decide(59, 10)).toBe('back')
    expect(decide(599, 10)).toBe('back')
    expect(decide(600, 10)).toBe('away')
    expect(decide(3600, 10)).toBe('away')
  })

  it('is off when nobody asked for it', () => {
    expect(decide(99999, 0)).toBe('back')
    expect(decide(99999, Number.NaN)).toBe('back')
    expect(decide(99999, -5)).toBe('back')
  })

  it('handles a one-minute setting', () => {
    expect(decide(59, 1)).toBe('back')
    expect(decide(60, 1)).toBe('away')
  })
})
