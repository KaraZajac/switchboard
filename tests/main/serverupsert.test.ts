import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { ServerConfig } from '@shared/types/server'

let userData: string

// A real database, because the bug was in the SQL — a column named and never
// bound. Against a fake this would have passed.
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`wrapped:${value}`),
    decryptString: (buffer: Buffer) => buffer.toString().replace(/^wrapped:/, '')
  }
}))

/**
 * Taking a network out of a shared config.
 *
 * `upsertServer` is the only path that inserts one, and it is reached only by
 * a device adopting another's config for a network it does not already have.
 * It named twenty-one columns and bound twenty, so it threw every time — and
 * since it throws part-way through applying the config, the two devices kept
 * their own lists and stayed apart for good.
 */

const config = (over: Partial<ServerConfig> = {}): ServerConfig => ({
  id: 'srv',
  name: 'netslum',
  host: 'irc.netslum.io',
  port: 6697,
  tls: true,
  password: null,
  nick: 'sbtest',
  username: 'sbtest',
  realname: 'Switchboard',
  saslMechanism: null,
  saslUsername: null,
  saslPassword: null,
  autoConnect: false,
  autoJoin: [],
  identifyCommand: null,
  performOnConnect: null,
  sortOrder: 0,
  websocketUrl: null,
  avatarUrl: null,
  profile: {},
  preAwayMessage: null,
  clientCert: null,
  ...over
})

type Servers = typeof import('../../src/main/storage/models/server')
type Messages = typeof import('../../src/main/storage/models/message')

let servers: Servers
let messages: Messages

beforeEach(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-upsert-'))
  vi.resetModules()
  const database = await import('../../src/main/storage/database')
  await database.initDatabase()
  servers = await import('../../src/main/storage/models/server')
  messages = await import('../../src/main/storage/models/message')
})

afterEach(async () => {
  const database = await import('../../src/main/storage/database')
  database.closeDatabase()
  fs.rmSync(userData, { recursive: true, force: true })
})

describe('adopting a network from a shared config', () => {
  it('inserts one this device has never had', () => {
    servers.upsertServer(config())

    expect(servers.getAllServers().map((s) => s.id)).toEqual(['srv'])
  })

  it('keeps a pinned certificate and the alternate nicks', () => {
    // Bound only by the update path before, so a network arriving in a shared
    // config lost both on the way in
    servers.upsertServer(config({ trustedCertificate: 'AB:CD', altNicks: ['sbtest_', 'sbtest__'] }))

    const stored = servers.getServer('srv')
    expect(stored?.trustedCertificate).toBe('AB:CD')
    expect(stored?.altNicks).toEqual(['sbtest_', 'sbtest__'])
  })

  it('updates one it already has rather than inserting twice', () => {
    servers.upsertServer(config())
    servers.upsertServer(config({ name: 'renamed' }))

    expect(servers.getAllServers()).toHaveLength(1)
    expect(servers.getServer('srv')?.name).toBe('renamed')
  })

  it('takes a whole list without stopping at the first new one', () => {
    for (const id of ['a', 'b', 'c']) servers.upsertServer(config({ id, name: id }))

    expect(servers.getAllServers().map((s) => s.id).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('the same network under the other device\'s id', () => {
  it('takes its messages with it instead of losing them', () => {
    servers.upsertServer(config({ id: 'old' }))
    messages.storeMessage({
      id: 'm1',
      serverId: 'old',
      channel: '#lobby',
      nick: 'robin',
      userHost: null,
      content: 'still here',
      type: 'privmsg',
      tags: {},
      replyTo: null,
      timestamp: '2026-09-14T01:00:00.000Z',
      account: null,
      channelContext: null
    })

    servers.upsertServer(config({ id: 'new' }))
    servers.reidentifyServer('old', 'new')

    expect(servers.getServer('old')).toBeFalsy()
    expect(messages.getMessages('new', '#lobby').map((m) => m.content)).toEqual(['still here'])
  })

  it('moving a network onto itself changes nothing', () => {
    servers.upsertServer(config())
    servers.reidentifyServer('srv', 'srv')

    expect(servers.getAllServers()).toHaveLength(1)
  })
})
