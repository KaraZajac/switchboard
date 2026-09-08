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
  list: [] as Array<{ id: string; autoConnect: boolean }>
}))

vi.mock('../../src/main/storage/models/server', () => ({
  getAllServers: () => servers.list
}))
vi.mock('../../src/main/storage/models/channel', () => ({
  getJoinedChannels: () => [],
  markChannelJoined: () => {},
  markChannelParted: () => {}
}))
vi.mock('../../src/main/storage/models/monitor', () => ({
  getMonitorList: () => []
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
