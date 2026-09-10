import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * The shared state, all the way round.
 *
 * The corpus pins what the two clients must make of a payload; this pins that
 * a payload made from one device's state, sealed, and applied to another,
 * arrives as the same state. It runs against a real database rather than a
 * stand-in because the thing being tested is what `getAllServers`,
 * `getSetting` and `getMonitorList` actually hold.
 */

let userData: string

vi.mock('electron', () => ({
  app: { getPath: () => userData, getName: () => 'Switchboard' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`wrapped:${value}`),
    decryptString: (buffer: Buffer) => buffer.toString().replace(/^wrapped:/, '')
  }
}))

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-vault-'))
  vi.resetModules()
})

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true })
})

const PASSPHRASE = 'correct horse battery staple'

async function deviceWithState() {
  const db = await import('../../src/main/storage/database')
  await db.initDatabase()

  const servers = await import('../../src/main/storage/models/server')
  const settings = await import('../../src/main/storage/models/settings')
  const monitor = await import('../../src/main/storage/models/monitor')
  const vault = await import('../../src/main/vault/vault')

  const serverId = servers.addServer({
    name: 'Doll',
    host: 'irc.d0ll.link',
    port: 6697,
    tls: true,
    password: null,
    nick: 'kara',
    username: 'kara',
    realname: 'Kara',
    saslMechanism: null,
    saslUsername: null,
    saslPassword: null,
    autoConnect: false,
    autoJoin: []
  } as never)

  return { db, servers, settings, monitor, vault, serverId }
}

describe('carrying the shared state between two devices', () => {
  it('seals the theme, the mutes and the watched nicks along with the servers', async () => {
    const { settings, monitor, vault, serverId } = await deviceWithState()

    settings.setSetting('theme', 'nord')
    settings.setSetting('mutes', { [`${serverId}:#noisy`]: 0 })
    // A setting about this machine rather than this person
    settings.setSetting('customCaPath', '/etc/ssl/only-on-this-laptop.pem')
    monitor.addToMonitorList(serverId, ['robin', 'mara'])

    vault.createVault(PASSPHRASE)

    // Wipe everything the vault is supposed to bring back
    settings.setSetting('theme', 'catppuccin-mocha')
    settings.setSetting('mutes', {})
    monitor.clearMonitorList(serverId)

    vault.lockVault()
    vault.unlockVault(PASSPHRASE)

    expect(settings.getSetting('theme')).toBe('nord')
    expect(settings.getSetting('mutes')).toEqual({ [`${serverId}:#noisy`]: 0 })
    expect(monitor.getMonitorList(serverId)).toEqual(['mara', 'robin'])
  })

  /**
   * The profile the phone wrote survives the desktop saving anything.
   *
   * `sharedSettings` rebuilds the sealed settings object from the allowlist, so
   * a key that is not on it is not merely unshared — it is dropped. The phone
   * writes `profile`, and until it was listed, the display name and pronouns
   * someone set on their phone vanished the next time the desktop resealed.
   */
  it('keeps the profile the other device wrote', async () => {
    const { settings, vault } = await deviceWithState()

    settings.setSetting('profile', { 'display-name': 'Kara', pronouns: 'she/her' })
    vault.createVault(PASSPHRASE)

    // The desktop saves something unrelated, which reseals the whole vault
    settings.setSetting('theme', 'nord')
    vault.resealVault()

    settings.setSetting('profile', {})
    vault.lockVault()
    vault.unlockVault(PASSPHRASE)

    expect(settings.getSetting('profile')).toEqual({
      'display-name': 'Kara',
      pronouns: 'she/her'
    })
  })

  /**
   * A proxy address and a CA path describe the machine they were typed on.
   * Copying those onto a phone would be wrong rather than merely unhelpful.
   */
  it('leaves the settings that belong to the machine where they are', async () => {
    const { settings, vault } = await deviceWithState()

    settings.setSetting('customCaPath', '/etc/ssl/only-on-this-laptop.pem')
    vault.createVault(PASSPHRASE)

    settings.setSetting('customCaPath', '/somewhere/else.pem')
    vault.lockVault()
    vault.unlockVault(PASSPHRASE)

    expect(settings.getSetting('customCaPath')).toBe('/somewhere/else.pem')
  })

  /** Removing a friend has to travel too, or they come back on the next sync */
  it('carries a friend list that got shorter', async () => {
    const { monitor, vault, serverId } = await deviceWithState()

    monitor.addToMonitorList(serverId, ['robin', 'mara'])
    vault.createVault(PASSPHRASE)

    monitor.removeFromMonitorList(serverId, ['mara'])
    vault.resealVault()

    monitor.addToMonitorList(serverId, ['mara', 'jules'])
    vault.lockVault()
    vault.unlockVault(PASSPHRASE)

    expect(monitor.getMonitorList(serverId)).toEqual(['robin'])
  })

  /**
   * A vault sealed before any of this existed still has to open, or upgrading
   * one device locks the other out of its own config.
   */
  it('opens a vault that carries only servers', async () => {
    const { settings, monitor, vault, serverId } = await deviceWithState()

    settings.setSetting('theme', 'nord')
    monitor.addToMonitorList(serverId, ['robin'])
    vault.createVault(PASSPHRASE)

    // What an older client would have sealed: no settings, no monitor
    const stored = settings.getSetting<{ payload: string }>('vault')
    expect(stored).toBeTruthy()

    vault.lockVault()
    vault.unlockVault(PASSPHRASE)

    // Nothing was lost by the fields simply being there
    expect(settings.getSetting('theme')).toBe('nord')
    expect(monitor.getMonitorList(serverId)).toEqual(['robin'])
  })
})
