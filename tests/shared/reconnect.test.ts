import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  reconnectDelay,
  saysSlowDown,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  THROTTLED_FLOOR_MS
} from '@shared/reconnect'

const corpus = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/reconnect.json'), 'utf8')
) as {
  baseMs: number
  maxMs: number
  throttledFloorMs: number
  slowDown: { name: string; text: string; slowDown: boolean }[]
  delays: { name: string; attempt: number; lastError: string | null; delayMs: number }[]
}

describe('coming back to a server that closed on us', () => {
  it('uses the constants the corpus was written against', () => {
    expect(RECONNECT_BASE_MS).toBe(corpus.baseMs)
    expect(RECONNECT_MAX_MS).toBe(corpus.maxMs)
    expect(THROTTLED_FLOOR_MS).toBe(corpus.throttledFloorMs)
  })

  for (const c of corpus.slowDown) {
    it(c.name || `reads "${c.text.slice(0, 40)}"`, () => {
      expect(saysSlowDown(c.text)).toBe(c.slowDown)
    })
  }

  it('says nothing about a message that is not there', () => {
    expect(saysSlowDown(null)).toBe(false)
    expect(saysSlowDown(undefined)).toBe(false)
  })

  for (const c of corpus.delays) {
    it(c.name || `attempt ${c.attempt} waits ${c.delayMs}ms`, () => {
      expect(reconnectDelay(c.attempt, c.lastError)).toBe(c.delayMs)
    })
  }

  /**
   * The shape of the bug, rather than one case of it.
   *
   * A server that accepts the connection and then closes it opens a socket —
   * which is what both clients used to count as success. Pinning the counter
   * at its first value is what that did, and this is what it cost.
   */
  it('a counter pinned at the first attempt dials for ever at the base delay', () => {
    const pinned = Array.from({ length: 30 }, () => reconnectDelay(1, null))
    const total = pinned.reduce((sum, wait) => sum + wait, 0)
    expect(total).toBe(30 * RECONNECT_BASE_MS)
    expect(total).toBeLessThan(RECONNECT_MAX_MS)

    // Counting properly, the same thirty attempts span hours rather than a minute
    const climbing = Array.from({ length: 30 }, (_, i) => reconnectDelay(i + 1, null))
    expect(climbing.reduce((sum, wait) => sum + wait, 0)).toBeGreaterThan(60 * 60 * 1000)
  })

  it('a throttled server is left alone for a minute, not dialled thirty times', () => {
    const said = 'Closing Link: [10.89.1.2] (Throttled: Reconnecting too fast)'
    // What the phone did: reset to 1 every time, so 60s of throttle took 30 dials
    expect(60_000 / reconnectDelay(1, null)).toBe(30)
    // What it does now
    expect(reconnectDelay(1, said)).toBe(60_000)
  })
})
