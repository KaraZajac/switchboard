import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The channels that came back after the desktop was opened.
 *
 * Reported from a phone: the shared config kept reverting to one that wanted
 * `#default` and `#hax` on a network the user had left them on, and only ever
 * after the desktop had been started.
 *
 * The desktop dials with the auto-join list it has — its own, possibly a week
 * old, because a config that changed while it was off has not reached it yet.
 * The `JOIN`s go out. Then the link comes up, the phone's newer config arrives
 * and is applied, and the auto-join list is now empty. *Then* the server's
 * acks land, one `JOIN` event each, and `rememberJoin` reads a config that no
 * longer lists them, concludes that somebody has just joined a new channel,
 * writes them back and reseals — at a version that beats the phone's.
 *
 * So the phone's decision is undone by the desktop carrying it out slowly.
 * It is the same bug as "leaving a channel on the phone did not stick", one
 * layer further in: that one was a stale *list*, this is a stale *dial*.
 */
const servers = vi.hoisted(() => ({
  list: [] as Array<{ id: string; autoConnect: boolean; autoJoin: string[] }>
}))

vi.mock('../../src/main/storage/models/server', () => ({
  getAllServers: () => servers.list,
  getServer: (id: string) => servers.list.find((server) => server.id === id),
  updateServer: (id: string, changes: Record<string, unknown>) => {
    const server = servers.list.find((entry) => entry.id === id)
    if (server) Object.assign(server, changes)
  }
}))
vi.mock('../../src/main/storage/models/channel', () => ({
  getJoinedChannels: () => [],
  markChannelJoined: () => {},
  markChannelParted: () => {}
}))
vi.mock('../../src/main/storage/models/monitor', () => ({ getMonitorList: () => [] }))

const vault = vi.hoisted(() => ({ reseals: 0 }))
vi.mock('../../src/main/vault/vault', () => ({
  resealVault: () => {
    vault.reseals++
  }
}))

const { IRCManager } = await import('../../src/main/irc/manager')

beforeEach(() => {
  servers.list = [{ id: 'doll', autoConnect: true, autoJoin: ['#default', '#hax'] }]
  vault.reseals = 0
})

/**
 * A manager that has just finished registering one connection.
 *
 * `noteDial` is what registration does, and a test that skips it is testing a
 * client that never connected; `rememberJoin` is what the `join` event runs.
 * The events themselves are bound by `bindClientEvents`, which reaches the
 * database and is not what is being tested here.
 */
function connected(autoJoin: string[]) {
  const manager = new IRCManager()
  ;(
    manager as unknown as { noteDial: (id: string, channels: readonly string[]) => void }
  ).noteDial('doll', autoJoin)

  return {
    /** The server acknowledging a join, as the read loop delivers it */
    join: (channel: string): void =>
      (manager as unknown as { rememberJoin: (id: string, channel: string) => void }).rememberJoin(
        'doll',
        channel
      )
  }
}


describe('a join that lands after the config moved on', () => {
  it('does not write the channel back', () => {
    // The desktop dials with the list it has, a week old
    const { join } = connected(['#default', '#hax'])

    // The phone's config arrives and is applied while the JOINs are in flight
    servers.list[0].autoJoin = []

    // …and now the acks land, one event per channel
    join('#default')
    join('#hax')

    expect(servers.list[0].autoJoin).toEqual([])
    expect(vault.reseals, 'nothing to tell anybody').toBe(0)
  })

  it('still records a channel somebody actually joined', () => {
    const { join } = connected(['#default', '#hax'])

    join('#somewhere-new')

    expect(servers.list[0].autoJoin).toContain('#somewhere-new')
    expect(vault.reseals).toBe(1)
  })

  it('and says nothing when the channel is already listed', () => {
    connected(['#default', '#hax']).join('#default')

    expect(servers.list[0].autoJoin).toEqual(['#default', '#hax'])
    expect(vault.reseals).toBe(0)
  })
})
