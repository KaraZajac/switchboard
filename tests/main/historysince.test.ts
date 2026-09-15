import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * What a returning device asks for.
 *
 * `history:fetch` reaches backwards from a point in one named conversation,
 * which is the wrong shape twice over for a phone that has been away: it does
 * not know which conversations it missed, and that is most of the problem.
 */

const world = vi.hoisted(() => ({
  rows: [] as unknown[][]
}))

/**
 * Rows in the column order `rowToMessage` reads, which is the table's own:
 * id, server, channel, nick, host, content, type, tags, reply, timestamp.
 */
const row = vi.hoisted(
  () =>
    (id: string, channel: string, timestamp: string): unknown[] =>
      [id, 'srv', channel, 'robin', null, id, 'privmsg', '{}', null, timestamp, null, null]
)

vi.mock('../../src/main/storage/database', () => ({
  getDb: () => ({
    exec: (_query: string, params: unknown[]) => {
      const [, after, limit] = params as [string, string, number]
      const matching = world.rows
        .filter((r) => (r[9] as string) > after)
        .sort((a, b) => (a[9] as string).localeCompare(b[9] as string))
        .slice(0, limit)
      return matching.length === 0 ? [] : [{ values: matching }]
    }
  })
}))
vi.mock('../../src/main/storage/models/reaction', () => ({
  reactionsFor: () => ({}),
  clearReactions: () => {}
}))

const { getMessagesSince } = await import('../../src/main/storage/models/message')

beforeEach(() => {
  world.rows = []
})

describe('catching a returning device up', () => {
  it('spans every conversation, not one', () => {
    world.rows = [
      row('a', '#lobby', '2026-09-14T01:00:00.000Z'),
      row('b', 'robin', '2026-09-14T01:00:01.000Z'),
      row('c', '#help', '2026-09-14T01:00:02.000Z')
    ]

    const found = getMessagesSince('srv', '2026-09-14T00:00:00.000Z')

    expect(found.map((m) => m.channel)).toEqual(['#lobby', 'robin', '#help'])
  })

  it('takes only what came after the moment asked for', () => {
    world.rows = [
      row('old', '#lobby', '2026-09-14T01:00:00.000Z'),
      row('new', '#lobby', '2026-09-14T03:00:00.000Z')
    ]

    expect(getMessagesSince('srv', '2026-09-14T02:00:00.000Z').map((m) => m.id)).toEqual(['new'])
  })

  it('comes back oldest first, so the last row is the next cursor', () => {
    world.rows = [
      row('third', '#lobby', '2026-09-14T03:00:00.000Z'),
      row('first', '#lobby', '2026-09-14T01:00:00.000Z'),
      row('second', '#lobby', '2026-09-14T02:00:00.000Z')
    ]

    expect(getMessagesSince('srv', '2026-09-13T00:00:00.000Z').map((m) => m.id)).toEqual([
      'first',
      'second',
      'third'
    ])
  })

  it('is capped, so a month away is walked and not swallowed', () => {
    world.rows = Array.from({ length: 900 }, (_, i) =>
      row(`m${i}`, '#lobby', `2026-09-14T01:${String(i % 60).padStart(2, '0')}:00.${String(i).padStart(3, '0')}Z`)
    )

    expect(getMessagesSince('srv', '2026-09-13T00:00:00.000Z', 250)).toHaveLength(250)
  })

  it('defaults to a page rather than everything', () => {
    world.rows = Array.from({ length: 900 }, (_, i) =>
      row(`m${i}`, '#lobby', `2026-09-14T01:${String(i % 60).padStart(2, '0')}:00.${String(i).padStart(3, '0')}Z`)
    )

    expect(getMessagesSince('srv', '2026-09-13T00:00:00.000Z')).toHaveLength(500)
  })

  it('says nothing when there is nothing newer', () => {
    world.rows = [row('old', '#lobby', '2026-09-14T01:00:00.000Z')]
    expect(getMessagesSince('srv', '2026-09-15T00:00:00.000Z')).toEqual([])
  })
})
