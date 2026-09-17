import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Leaving a channel while the network is down.
 *
 * Wanting out of a channel is two things at once: a `PART` on the wire, and a
 * decision about the list this device dials on every connection. Only the
 * first needs a socket, and only the second lasts.
 *
 * It used to be only the first. The auto-join list was pruned as a side effect
 * of the server echoing our own `PART` back, so with nothing connected the
 * handler threw `Not connected` — seen in the desktop's journal — the window
 * removed the channel from its own list anyway, and the next connection
 * dialled straight back into it. A channel left while offline came back, and
 * the only sign of it was a rejected promise nobody was listening for.
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
  servers.list = [{ id: 'doll', autoConnect: true, autoJoin: ['#hax', '#lounge'] }]
  vault.reseals = 0
})

/** A manager with an optional connection on it, and what that connection sent */
function manager(connected: boolean | null) {
  const sent: string[][] = []
  const instance = new IRCManager()

  if (connected !== null) {
    const client = {
      connection: { connected },
      part: (channel: string) => sent.push(['PART', channel]),
      destroy: () => {}
    }
    ;(instance as unknown as { clients: Map<string, unknown> }).clients.set('doll', client)
  }

  return { instance, sent }
}

describe('leaving a channel', () => {
  it('takes it off the auto-join list with nothing connected', () => {
    const { instance } = manager(null)

    instance.leave('doll', '#lounge')

    expect(servers.list[0].autoJoin).toEqual(['#hax'])
    expect(vault.reseals, 'and the other device is told').toBe(1)
  })

  it('does the same for a connection that is dialling rather than up', () => {
    // A client the manager still knows about but which is not registered:
    // waiting to redial, or backing off after a refusal.
    const { instance, sent } = manager(false)

    instance.leave('doll', '#lounge')

    expect(servers.list[0].autoJoin).toEqual(['#hax'])
    expect(sent, 'nothing to send it down').toEqual([])
  })

  it('sends the PART as well when there is a socket', () => {
    const { instance, sent } = manager(true)

    instance.leave('doll', '#lounge')

    expect(sent).toEqual([['PART', '#lounge']])
    expect(servers.list[0].autoJoin).toEqual(['#hax'])
  })

  it('says nothing twice when the server echoes the part back', () => {
    // `forgetJoin` runs again on the `part` event, which is how a part made
    // anywhere else reaches the config. It must not reseal a second time.
    const { instance } = manager(true)

    instance.leave('doll', '#lounge')
    ;(instance as unknown as { forgetJoin: (s: string, c: string) => void }).forgetJoin(
      'doll',
      '#lounge'
    )

    expect(vault.reseals).toBe(1)
  })

  it('leaves a channel that was never listed alone', () => {
    const { instance, sent } = manager(true)

    instance.leave('doll', '#somewhere-else')

    expect(servers.list[0].autoJoin).toEqual(['#hax', '#lounge'])
    expect(vault.reseals).toBe(0)
    expect(sent, 'still asked to go, though').toEqual([['PART', '#somewhere-else']])
  })

  it('is matched however the two spell it', () => {
    const { instance } = manager(true)

    instance.leave('doll', '#LOUNGE')

    expect(servers.list[0].autoJoin).toEqual(['#hax'])
  })
})
