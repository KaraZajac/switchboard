import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * What a phone hands over after a spell holding the connections.
 *
 * The phone has no database, so those messages exist nowhere else. Everything
 * arriving here is a paired device's word for what happened, which is why the
 * shape is checked, the server has to be one we have, and a batch is capped.
 */

const world = vi.hoisted(() => ({
  servers: ['known'] as string[],
  stored: [] as Array<Record<string, unknown>>,
  /** Ids the database will not take, for the case where one row is bad */
  refuse: [] as string[]
}))

vi.mock('../../src/main/storage/models/server', () => ({
  getServer: (id: string) => (world.servers.includes(id) ? { id } : undefined)
}))
vi.mock('../../src/main/storage/models/message', () => ({
  storeMessage: (row: Record<string, unknown>) => {
    if (world.refuse.includes(row.id as string)) throw new Error('constraint failed')
    world.stored.push(row)
  }
}))

const { storeHandover, HANDOVER_LIMIT } = await import('../../src/main/storage/handover')

const message = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'm1',
  channel: '#lobby',
  nick: 'robin',
  content: 'while you were out',
  timestamp: '2026-09-14T01:00:00.000Z',
  type: 'privmsg',
  ...over
})

beforeEach(() => {
  world.servers = ['known']
  world.stored = []
  world.refuse = []
})

describe('taking what the phone heard', () => {
  it('stores a message against the server it came from', () => {
    expect(storeHandover('known', [message()])).toBe(1)
    expect(world.stored[0]).toMatchObject({
      id: 'm1',
      serverId: 'known',
      channel: '#lobby',
      nick: 'robin',
      content: 'while you were out',
      type: 'privmsg'
    })
  })

  it('keeps a direct message, which is the half no server will replay', () => {
    storeHandover('known', [message({ channel: 'robin', id: 'dm1' })])
    expect(world.stored[0]).toMatchObject({ channel: 'robin', id: 'dm1' })
  })

  it('puts the tags back, so an operator still reads as one', () => {
    storeHandover('known', [message({ oper: 'staff', relayedBy: 'bridge', replyTo: 'm0' })])
    expect(world.stored[0].tags).toEqual({
      'draft/oper': 'staff',
      'draft/relaymsg': 'bridge',
      '+draft/reply': 'm0'
    })
    expect(world.stored[0].replyTo).toBe('m0')
  })

  it('refuses a network this desktop does not have, rather than dropping it', () => {
    // Returning 0 here is indistinguishable from "already had them all", and
    // the phone marked them handed over on the strength of it — losing the
    // only copy of everything it heard while it was the connection.
    expect(() => storeHandover('unknown', [message()])).toThrow(/No such network/)
    expect(world.stored).toEqual([])
  })

  it('skips anything that is not a message, and keeps the rest', () => {
    const stored = storeHandover('known', [
      null,
      'nonsense',
      { id: 'no-channel', content: 'x', timestamp: 'now' },
      { channel: '#lobby', content: 'no id', timestamp: 'now' },
      message({ id: 'good' })
    ])
    expect(stored).toBe(1)
    expect(world.stored[0]).toMatchObject({ id: 'good' })
  })

  it('takes only as much as it said it would', () => {
    const many = Array.from({ length: HANDOVER_LIMIT + 50 }, (_, i) => message({ id: `m${i}` }))
    expect(storeHandover('known', many)).toBe(HANDOVER_LIMIT)
  })

  it('carries on after a row the database refuses', () => {
    world.refuse = ['a']

    // One bad row is not a reason to drop the rest of the night
    expect(storeHandover('known', [message({ id: 'a' }), message({ id: 'b' })])).toBe(1)
    expect(world.stored.map((row) => row.id)).toEqual(['b'])
  })

  it('defaults the type, because an older phone may not send one', () => {
    storeHandover('known', [{ id: 'm', channel: '#lobby', content: 'x', timestamp: 'now' }])
    expect(world.stored[0]).toMatchObject({ type: 'privmsg', nick: '' })
  })
})
