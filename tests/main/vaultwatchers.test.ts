import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * Who gets told when the shared config changes.
 *
 * It used to be one thing — the remote link, which offers the new version to
 * paired devices. A headless instance wants to know too, so it can try the
 * passphrase it was given against a config that has just arrived from a
 * desktop. Registering the second listener replaced the first, and the symptom
 * was the worst kind: everything looked connected and nothing was ever
 * offered.
 */

let userData: string

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-watch-'))
  vi.resetModules()
})

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true })
})

async function openDatabase() {
  const platform = await import('../../src/main/host')
  platform.setHost(platform.testHost(userData))
  const db = await import('../../src/main/storage/database')
  await db.initDatabase()
  return import('../../src/main/vault/vault')
}

describe('watching the shared config', () => {
  it('tells every listener, not just the last one to ask', async () => {
    const vault = await openDatabase()
    const told: string[] = []

    vault.onVaultChanged(() => told.push('link'))
    vault.onVaultChanged(() => told.push('headless'))

    vault.createVault('correct horse battery staple')

    expect(told).toEqual(['link', 'headless'])
  })

  it('stops telling one that has gone away', async () => {
    const vault = await openDatabase()
    const told: string[] = []

    const stop = vault.onVaultChanged(() => told.push('link'))
    vault.onVaultChanged(() => told.push('headless'))
    stop()

    vault.createVault('correct horse battery staple')

    expect(told).toEqual(['headless'])
  })

  it('says so when a config arrives from somewhere else', async () => {
    const passphrase = 'correct horse battery staple'

    // One device makes a config and moves it on a version
    const first = await openDatabase()
    first.createVault(passphrase)
    first.resealVault()
    const envelope = first.exportVault()
    expect(envelope?.version).toBe(2)

    // A second device, which has never seen one
    const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-watch2-'))
    vi.resetModules()
    const platform = await import('../../src/main/host')
    platform.setHost(platform.testHost(secondDir))
    const db = await import('../../src/main/storage/database')
    await db.initDatabase()
    const second = await import('../../src/main/vault/vault')

    const told: number[] = []
    second.onVaultChanged((version) => told.push(version))

    const result = second.importVault(envelope!)

    expect(result.accepted).toBe(true)
    // With two devices the sender already had it. With three, this is the only
    // way the third one hears — and on a headless instance it is the cue to
    // try the passphrase it was given.
    expect(told).toEqual([2])

    fs.rmSync(secondDir, { recursive: true, force: true })
  })
})
