import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Channels that came back by themselves.
 *
 * Reported twice from a phone: the shared config kept reverting to one that
 * wanted `#default` as well as `#hax` on `irc.d0ll.link`. Take `#default` out,
 * save, close the app, open it — and it is back.
 *
 * There are two ways a `JOIN` for ourselves can arrive that nobody decided on,
 * and a join is written into the config that both devices read, so either of
 * them grows a list that cannot be pruned:
 *
 *  - **The server put us there.** `irc.d0ll.link` is UnrealIRCd with
 *    `set::auto-join`. A bare socket that registers and asks for nothing at
 *    all is sent `JOIN :#default` by the server. Services rejoining an account
 *    where it usually is, an operator's `SAJOIN` and a `+L` forward out of a
 *    full channel are the same shape.
 *  - **A dial landed after the config moved on.** The desktop connects with
 *    the auto-join list it has, possibly a week old. The link comes up, the
 *    phone's newer config arrives and is applied, and the list is now empty.
 *    *Then* the acks land, one `JOIN` each, against a config that no longer
 *    lists them — so they are read as new and written back, at a vault version
 *    that beats the phone's.
 *
 * The rule both clients keep: a join is worth recording only where somebody
 * on this device asked for it, and asked for it as a decision rather than as
 * this connection carrying out a list it already had.
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
const { IRCClient } = await import('../../src/main/irc/client')

beforeEach(() => {
  servers.list = [{ id: 'doll', autoConnect: true, autoJoin: ['#default', '#hax'] }]
  vault.reseals = 0
})

/**
 * A manager with one connection on it.
 *
 * The real `IRCClient`, because the bookkeeping being tested lives on it — a
 * stand-in would be testing the stand-in. `bindClientEvents` is not used: it
 * reaches the database, and the two methods below are the whole of what the
 * `join` event runs.
 */
function connected() {
  const manager = new IRCManager()
  const client = new IRCClient({
    id: 'doll',
    name: 'd0ll',
    host: 'irc.d0ll.link',
    port: 6697,
    tls: true,
    nick: 'kara',
    autoJoin: [],
    autoConnect: true
  } as never)
  ;(manager as unknown as { clients: Map<string, unknown> }).clients.set('doll', client)

  return {
    client,
    /** What registration does for each channel in the list it dialled with */
    dial: (channel: string): void => client.noteJoinRequest(channel, 'dial'),
    /** The server acknowledging a join, as the read loop delivers it */
    join: (channel: string): void =>
      (manager as unknown as { rememberJoin: (id: string, channel: string) => void }).rememberJoin(
        'doll',
        channel
      )
  }
}

describe('a join nobody on this device asked for', () => {
  it('is not written into the config', () => {
    const { join } = connected()

    // No `JOIN` was ever sent for this. The server simply says we are in it.
    join('#default')
    join('#hax')

    expect(servers.list[0].autoJoin).toEqual(['#default', '#hax'])
    expect(vault.reseals, 'nothing to tell anybody').toBe(0)
  })

  it('and does not add a channel the list had been pruned of', () => {
    // The shape of the report: `#default` taken out and saved, and the next
    // connection to a server that force-joins it puts it back.
    servers.list[0].autoJoin = ['#hax']
    const { join } = connected()

    join('#default')

    expect(servers.list[0].autoJoin).toEqual(['#hax'])
    expect(vault.reseals).toBe(0)
  })
})

describe('a join that lands after the config moved on', () => {
  it('does not write the channel back', () => {
    // The desktop dials with the list it has, a week old
    const { dial, join } = connected()
    dial('#default')
    dial('#hax')

    // The phone's config arrives and is applied while the JOINs are in flight
    servers.list[0].autoJoin = []

    // …and now the acks land, one event per channel
    join('#default')
    join('#hax')

    expect(servers.list[0].autoJoin).toEqual([])
    expect(vault.reseals, 'nothing to tell anybody').toBe(0)
  })

  it('leaves the question answered, so going back later is a decision', () => {
    // A dial left sitting on the client would be spent by the *next* join of
    // the same channel, which is a real one.
    const { client, dial, join } = connected()
    servers.list[0].autoJoin = []
    dial('#hax')
    join('#hax')

    client.join('#hax')
    join('#hax')

    expect(servers.list[0].autoJoin).toEqual(['#hax'])
    expect(vault.reseals).toBe(1)
  })
})

describe('a join somebody asked for', () => {
  it('is recorded, and the vault resealed', () => {
    const { client, join } = connected()

    client.join('#somewhere-new')
    join('#somewhere-new')

    expect(servers.list[0].autoJoin).toContain('#somewhere-new')
    expect(vault.reseals).toBe(1)
  })

  it('says nothing when the channel is already listed', () => {
    const { client, join } = connected()

    client.join('#default')
    join('#default')

    expect(servers.list[0].autoJoin).toEqual(['#default', '#hax'])
    expect(vault.reseals).toBe(0)
  })

  it('is matched however the server spells it back', () => {
    // Asked for in one case and acknowledged in another, which servers do.
    // Recorded once, in the spelling the server used — that is the one the
    // network will answer to.
    const { client, join } = connected()

    client.join('#SomeWhere')
    join('#somewhere')

    expect(servers.list[0].autoJoin).toEqual(['#default', '#hax', '#somewhere'])
    expect(vault.reseals).toBe(1)
  })
})
