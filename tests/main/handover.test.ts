import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Releasing and resuming the connections.
 *
 * These are the two failures a real handover produced on the emulator: turning
 * the link on dropped every live connection and brought the user back as
 * `nick_`, because the server still held their real nick in a ping timeout; and
 * a release has to put back exactly what it took, no more and no less.
 */

const servers = vi.hoisted(() => ({
  list: [] as Array<{
    id: string
    autoConnect: boolean
    autoJoin?: string[]
    saslMechanism?: string | null
    saslPassword?: string | null
  }>
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
vi.mock('../../src/main/storage/models/monitor', () => ({
  getMonitorList: () => []
}))

/** What the shared config was told, so a join can be checked for telling it */
const vault = vi.hoisted(() => ({ reseals: 0 }))
vi.mock('../../src/main/vault/vault', () => ({
  resealVault: () => {
    vault.reseals++
  }
}))

const { IRCManager } = await import('../../src/main/irc/manager')

/** A manager whose connects are recorded rather than dialled */
function managerWithFakeClients(live: string[]) {
  const manager = new IRCManager()
  const clients = (manager as unknown as { clients: Map<string, unknown> }).clients
  const connected: string[] = []

  for (const id of live) clients.set(id, { destroy: () => {} })
  ;(manager as unknown as { connect: (c: { id: string }) => void }).connect = (config) => {
    connected.push(config.id)
    clients.set(config.id, { destroy: () => {} })
  }
  ;(manager as unknown as { send: () => void }).send = () => {}

  return { manager, clients, connected }
}

beforeEach(() => {
  servers.list = [
    { id: 'a', autoConnect: true },
    { id: 'b', autoConnect: true },
    { id: 'c', autoConnect: false }
  ]
})

describe('taking the connections back', () => {
  it('leaves an already-connected server alone', () => {
    const { manager, connected } = managerWithFakeClients(['a', 'b'])

    // Becoming primary while already on the network — the case that dropped
    // the user and reconnected them as nick_
    manager.resumeConnections()

    expect(connected).toEqual([])
  })

  it('connects the auto-connect servers that are not up yet', () => {
    const { manager, connected } = managerWithFakeClients(['a'])
    manager.resumeConnections()
    expect(connected).toEqual(['b'])
  })

  it('never opens a server the user turned auto-connect off for', () => {
    const { manager, connected } = managerWithFakeClients([])
    manager.resumeConnections()
    expect(connected).not.toContain('c')
  })

  it('brings back exactly what it released, including manual connections', () => {
    // 'c' is not auto-connect, but the user connected it by hand — handing over
    // and back must not quietly drop it.
    const { manager, clients, connected } = managerWithFakeClients(['a', 'c'])

    manager.releaseConnections()
    expect(clients.size).toBe(0)

    manager.resumeConnections()
    expect(connected.sort()).toEqual(['a', 'c'])
  })

  it('a second resume does nothing, so a repeated claim is harmless', () => {
    const { manager, connected } = managerWithFakeClients([])
    manager.resumeConnections()
    const afterFirst = [...connected]

    manager.resumeConnections()
    expect(connected).toEqual(afterFirst)
  })
})

/**
 * Networks both devices can be on at once.
 *
 * Handing over is for networks that allow only one of us. Where the server lets
 * two sessions of one account in — and the config carries credentials for both
 * to arrive as — there is nothing to hand over: the other device has its own
 * socket beside ours, and dropping ours would take this desktop off a network
 * it is perfectly able to stay on.
 */
describe('handing over a network both devices can share', () => {
  beforeEach(() => {
    servers.list = [
      { id: 'a', autoConnect: true },
      { id: 'shared', autoConnect: true, saslMechanism: 'PLAIN', saslPassword: 'hunter2pass' }
    ]
  })

  it('keeps the shared one and gives up the rest', () => {
    const { manager, clients } = managerWithFakeClients(['a', 'shared'])

    manager.releaseConnections()

    expect([...clients.keys()]).toEqual(['shared'])
  })

  it('brings back only what it actually released', () => {
    const { manager, connected } = managerWithFakeClients(['a', 'shared'])

    manager.releaseConnections()
    manager.resumeConnections()

    // 'shared' was never released, so reconnecting it would drop a live
    // connection and bring the user back under a nick the server hands out
    // because their real one is still in a ping timeout.
    expect(connected).toEqual(['a'])
  })

  it('a mechanism with no password is not something to share', () => {
    servers.list = [
      { id: 'half', autoConnect: true, saslMechanism: 'PLAIN', saslPassword: null }
    ]
    const { manager, clients } = managerWithFakeClients(['half'])

    manager.releaseConnections()

    expect(clients.size).toBe(0)
  })
})

/**
 * A channel joined here has to reach the phone, and the phone reads its
 * channels out of the shared config — so joining has to reseal it. It did
 * not: the config was only ever resealed by the settings and server-editing
 * handlers, so a channel joined on the desktop stayed on the desktop until
 * some unrelated edit happened to carry it across.
 */
describe('telling the other device about a channel', () => {
  const joinFor = (manager: unknown, id: string, channel: string): void =>
    (manager as { rememberJoin: (s: string, c: string) => void }).rememberJoin(id, channel)

  const partFor = (manager: unknown, id: string, channel: string): void =>
    (manager as { forgetJoin: (s: string, c: string) => void }).forgetJoin(id, channel)

  beforeEach(() => {
    vault.reseals = 0
    servers.list = [{ id: 'a', autoConnect: true, autoJoin: [] }]
  })

  it('reseals the shared config when a channel is joined', () => {
    const { manager } = managerWithFakeClients([])

    joinFor(manager, 'a', '#lobby')

    expect(servers.list[0].autoJoin).toEqual(['#lobby'])
    expect(vault.reseals).toBe(1)
  })

  it('and when one is left', () => {
    const { manager } = managerWithFakeClients([])

    joinFor(manager, 'a', '#lobby')
    partFor(manager, 'a', '#lobby')

    expect(servers.list[0].autoJoin).toEqual([])
    expect(vault.reseals).toBe(2)
  })

  it('says nothing when the channel is already listed', () => {
    const { manager } = managerWithFakeClients([])

    joinFor(manager, 'a', '#lobby')
    joinFor(manager, 'a', '#LOBBY')

    expect(vault.reseals).toBe(1)
  })
})
