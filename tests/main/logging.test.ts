import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/main/storage/models/settings', () => ({ getSetting: () => null }))
vi.mock('../../src/main/storage/models/server', () => ({ getServer: () => null }))

import { setHost, testHost } from '../../src/main/host'
import { logLineFor } from '../../src/main/logging'

setHost(testHost('/tmp/switchboard-test'))

/** The shape every other client's logs take, so a tool that reads theirs reads ours */
describe('a log line', () => {
  const at = '2026-09-13T20:15:30.000Z'
  const stampOf = (line: string): string => line.slice(0, 19)

  it('writes a message the way irssi does', () => {
    const line = logLineFor({ nick: 'robin', content: 'hello', type: 'privmsg', timestamp: at })
    expect(line.slice(20)).toBe('<robin> hello')
    expect(stampOf(line)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('marks an action, a notice and an event', () => {
    expect(logLineFor({ nick: 'robin', content: 'waves', type: 'action', timestamp: at }).slice(20)).toBe(' * robin waves')
    expect(logLineFor({ nick: 'robin', content: 'psst', type: 'notice', timestamp: at }).slice(20)).toBe('-robin- psst')
    expect(logLineFor({ nick: '', content: 'robin joined the channel', type: 'system', timestamp: at }).slice(20)).toBe('-!- robin joined the channel')
  })

  it('survives a timestamp that is not one', () => {
    expect(logLineFor({ nick: 'robin', content: 'x', type: 'privmsg', timestamp: 'never' })).toContain('<robin> x')
  })
})
