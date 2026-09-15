import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Away while nobody is reading.
 *
 * A bouncer stays on the network whether or not anybody is looking, which is
 * the point and also the problem: to everybody else you are present and simply
 * not answering.
 */

const settings = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))

vi.mock('../../src/main/storage/models/settings', () => ({
  getSetting: (key: string) => settings.values[key] ?? null
}))

import { watchWhoIsReading, stopWatchingWhoIsReading } from '../../src/main/bouncer/presence'
import type { IRCManager } from '../../src/main/irc/manager'

function fakeManager(): { manager: IRCManager; sent: string[][]; away: { value: boolean } } {
  const sent: string[][] = []
  const away = { value: false }
  const client = {
    state: {
      registrationState: 'connected',
      get away() {
        return away.value
      }
    },
    connection: { send: (...args: string[]) => sent.push(args) }
  }
  return {
    manager: { connections: () => [['net1', client]] } as unknown as IRCManager,
    sent,
    away
  }
}

describe('going away while nobody is attached', () => {
  beforeEach(() => {
    settings.values = {}
    vi.useFakeTimers()
  })

  afterEach(() => {
    stopWatchingWhoIsReading()
    vi.useRealTimers()
  })

  it('does nothing while a client is attached', () => {
    const { manager, sent } = fakeManager()
    watchWhoIsReading(manager, { attached: () => 1, linked: () => 0 })

    vi.advanceTimersByTime(60 * 60 * 1000)

    expect(sent).toEqual([])
  })

  it('does nothing while a paired device is on the link', () => {
    const { manager, sent } = fakeManager()
    // Counting only IRC clients would mark somebody away while they read on
    // their phone
    watchWhoIsReading(manager, { attached: () => 0, linked: () => 1 })

    vi.advanceTimersByTime(60 * 60 * 1000)

    expect(sent).toEqual([])
  })

  it('goes away once nothing has been attached for long enough', () => {
    const { manager, sent, away } = fakeManager()
    watchWhoIsReading(manager, { attached: () => 0, linked: () => 0 })
    expect(sent).toEqual([])

    vi.advanceTimersByTime(6 * 60 * 1000)
    away.value = sent.length > 0

    expect(sent).toHaveLength(1)
    expect(sent[0][0]).toBe('AWAY')
    expect(sent[0][1]).toBeTruthy()
  })

  it('says it once, not every half minute', () => {
    const { manager, sent, away } = fakeManager()
    watchWhoIsReading(manager, { attached: () => 0, linked: () => 0 })

    vi.advanceTimersByTime(6 * 60 * 1000)
    away.value = true
    vi.advanceTimersByTime(30 * 60 * 1000)

    expect(sent).toHaveLength(1)
  })

  it('comes back when something attaches', () => {
    const { manager, sent, away } = fakeManager()
    let attached = 0
    watchWhoIsReading(manager, { attached: () => attached, linked: () => 0 })

    vi.advanceTimersByTime(6 * 60 * 1000)
    away.value = true
    attached = 1
    vi.advanceTimersByTime(30 * 1000)

    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(['AWAY'])
  })

  it('leaves an away somebody set themselves alone', () => {
    const { manager, sent, away } = fakeManager()
    // Clearing this because a client attached tells the channel they are back
    // from a lunch they are still at
    away.value = true
    let attached = 0
    watchWhoIsReading(manager, { attached: () => attached, linked: () => 0 })

    vi.advanceTimersByTime(6 * 60 * 1000)
    attached = 1
    vi.advanceTimersByTime(30 * 1000)

    expect(sent).toEqual([])
  })

  it('can be switched off', () => {
    settings.values['bouncerAwayMinutes'] = 0
    const { manager, sent } = fakeManager()
    watchWhoIsReading(manager, { attached: () => 0, linked: () => 0 })

    vi.advanceTimersByTime(60 * 60 * 1000)

    expect(sent).toEqual([])
  })
})
