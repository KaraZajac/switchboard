import { describe, it, expect, vi } from 'vitest'
import {
  deriveKey,
  deriveKeyFor,
  fingerprintsMatch,
  generateSalt,
  keyFingerprint,
  openVault,
  sealVault,
  VaultLockedError,
  VAULT_FORMAT
} from '../../src/main/vault/crypto'

// Real KDF cost is the point in production and a waste in tests
const FAST = 1000

const meta = (version = 1) => ({
  version,
  updatedAt: '2026-09-08T00:00:00.000Z',
  updatedBy: 'desktop-test'
})

const secretConfig = {
  servers: [
    {
      id: 'a',
      name: 'Doll',
      host: 'irc.d0ll.link',
      saslPassword: 'hunter2',
      password: 'server-pw'
    }
  ]
}

describe('vault crypto', () => {
  it('round-trips a payload with the right passphrase', () => {
    const salt = generateSalt()
    const key = deriveKey('correct horse battery staple', salt, FAST)
    const envelope = sealVault(secretConfig, key, salt, meta(), FAST)

    expect(openVault(envelope, key)).toEqual(secretConfig)
  })

  it('never leaves the secrets in the envelope', () => {
    const salt = generateSalt()
    const key = deriveKey('passphrase', salt, FAST)
    const envelope = sealVault(secretConfig, key, salt, meta(), FAST)

    const serialised = JSON.stringify(envelope)
    expect(serialised).not.toContain('hunter2')
    expect(serialised).not.toContain('server-pw')
    expect(serialised).not.toContain('d0ll.link')
  })

  it('refuses the wrong passphrase', () => {
    const salt = generateSalt()
    const envelope = sealVault(secretConfig, deriveKey('right', salt, FAST), salt, meta(), FAST)

    expect(() => openVault(envelope, deriveKey('wrong', salt, FAST))).toThrow(VaultLockedError)
  })

  it('derives the same key from the same passphrase and salt', () => {
    const salt = generateSalt()
    expect(deriveKey('same', salt, FAST)).toEqual(deriveKey('same', salt, FAST))
    expect(deriveKey('same', generateSalt(), FAST)).not.toEqual(deriveKey('same', salt, FAST))
  })

  it('normalises unicode passphrases, so the same typing opens it anywhere', () => {
    const salt = generateSalt()
    // "café" composed vs decomposed — different bytes, same passphrase to a human
    const composed = 'café'
    const decomposed = 'café'
    expect(deriveKey(composed, salt, FAST)).toEqual(deriveKey(decomposed, salt, FAST))
  })

  it('rejects an empty passphrase rather than sealing with a weak key', () => {
    expect(() => deriveKey('', generateSalt(), FAST)).toThrow(/cannot be empty/i)
  })

  it('detects a rewritten version — no silent rollback', () => {
    const salt = generateSalt()
    const key = deriveKey('passphrase', salt, FAST)
    const envelope = sealVault(secretConfig, key, salt, meta(9), FAST)

    // A peer claims this old vault is newer than it is
    const tampered = { ...envelope, version: 99 }
    expect(() => openVault(tampered, key)).toThrow(VaultLockedError)
  })

  it('detects tampering with the author or timestamp', () => {
    const salt = generateSalt()
    const key = deriveKey('passphrase', salt, FAST)
    const envelope = sealVault(secretConfig, key, salt, meta(), FAST)

    expect(() => openVault({ ...envelope, updatedBy: 'someone-else' }, key)).toThrow(
      VaultLockedError
    )
    expect(() => openVault({ ...envelope, updatedAt: '2020-01-01T00:00:00.000Z' }, key)).toThrow(
      VaultLockedError
    )
  })

  it('detects tampering with the ciphertext', () => {
    const salt = generateSalt()
    const key = deriveKey('passphrase', salt, FAST)
    const envelope = sealVault(secretConfig, key, salt, meta(), FAST)

    const bytes = Buffer.from(envelope.ciphertext, 'base64')
    bytes[0] ^= 0xff
    expect(() =>
      openVault({ ...envelope, ciphertext: bytes.toString('base64') }, key)
    ).toThrow(VaultLockedError)
  })

  it('refuses a format it does not understand', () => {
    const salt = generateSalt()
    const key = deriveKey('passphrase', salt, FAST)
    const envelope = sealVault(secretConfig, key, salt, meta(), FAST)

    expect(() => openVault({ ...envelope, format: VAULT_FORMAT + 1 }, key)).toThrow(
      /unsupported vault format/i
    )
  })

  it('carries its own KDF parameters, so an old vault still opens', () => {
    const salt = generateSalt()
    const key = deriveKey('passphrase', salt, 2048)
    const envelope = sealVault(secretConfig, key, salt, meta(), 2048)

    expect(envelope.kdf.iterations).toBe(2048)
    expect(openVault(envelope, deriveKeyFor(envelope, 'passphrase'))).toEqual(secretConfig)
  })

  it('fingerprints match only for the same key', () => {
    const salt = generateSalt()
    const key = deriveKey('shared', salt, FAST)
    const same = deriveKey('shared', salt, FAST)
    const other = deriveKey('different', salt, FAST)

    expect(fingerprintsMatch(keyFingerprint(key), keyFingerprint(same))).toBe(true)
    expect(fingerprintsMatch(keyFingerprint(key), keyFingerprint(other))).toBe(false)
    // and the fingerprint is not the key
    expect(keyFingerprint(key)).not.toContain(key.toString('hex').slice(0, 8))
  })
})

/**
 * What actually goes into the vault.
 *
 * The credentials are the reason the vault exists: a phone that takes over has
 * to be able to authenticate as the user. They are stored encrypted on the
 * desktop, so the payload must carry the decrypted values — and the sealed
 * envelope must still show none of them.
 */
describe('what the vault carries', () => {
  it('seals credentials the other device can actually use', () => {
    const salt = generateSalt()
    const key = deriveKey('passphrase', salt, FAST)

    const payload = {
      version: 1,
      servers: [
        {
          id: 'a',
          name: 'Libera',
          host: 'irc.libera.chat',
          nick: 'kara',
          saslMechanism: 'PLAIN',
          saslUsername: 'kara',
          saslPassword: 'the-real-password',
          password: 'server-password',
          identifyCommand: '/msg NickServ IDENTIFY kara the-real-password'
        }
      ]
    }

    const envelope = sealVault(payload, key, salt, meta(), FAST)

    // Nothing readable on the wire…
    const onTheWire = JSON.stringify(envelope)
    expect(onTheWire).not.toContain('the-real-password')
    expect(onTheWire).not.toContain('server-password')
    expect(onTheWire).not.toContain('NickServ')

    // …and everything usable once opened
    const opened = openVault<typeof payload>(envelope, key)
    expect(opened.servers[0].saslPassword).toBe('the-real-password')
    expect(opened.servers[0].password).toBe('server-password')
    expect(opened.servers[0].identifyCommand).toContain('NickServ')
  })
})

/**
 * What the UI is told about the vault.
 *
 * The status drives which form the settings panel shows, so a state it cannot
 * describe is a state the user cannot get out of.
 */
describe('reporting the vault state', () => {
  /** vault.ts talks to the settings table and the server list; both stand in here */
  async function freshVault() {
    const settings = new Map<string, unknown>()
    const servers: unknown[] = []

    vi.resetModules()
    vi.doMock('../../src/main/storage/models/settings', () => ({
      getSetting: (key: string) => settings.get(key) ?? null,
      setSetting: (key: string, value: unknown) => {
        if (value === null) settings.delete(key)
        else settings.set(key, value)
      },
      deleteSetting: (key: string) => settings.delete(key)
    }))
    vi.doMock('../../src/main/storage/models/server', () => ({
      getAllServers: () => servers,
      upsertServer: () => {},
      removeServer: () => {}
    }))

    const vault = await import('../../src/main/vault/vault')
    return { ...vault, forgetEnvelope: () => settings.delete('vault') }
  }

  it('is not unlocked when there is no vault', async () => {
    const { vaultStatus, createVault } = await freshVault()

    expect(vaultStatus()).toMatchObject({ exists: false, unlocked: false, fingerprint: null })

    createVault('a-good-long-passphrase')
    expect(vaultStatus()).toMatchObject({ exists: true, unlocked: true })
    expect(vaultStatus().fingerprint).toBeTruthy()
  })

  it('reports locked once the key is dropped, and keeps the vault', async () => {
    const { vaultStatus, createVault, lockVault } = await freshVault()

    createVault('a-good-long-passphrase')
    lockVault()

    expect(vaultStatus()).toMatchObject({ exists: true, unlocked: false, fingerprint: null })
  })

  /**
   * The envelope can go while the key is still held — a settings row cleared,
   * a device wiped from the other end. Calling that "unlocked" hid the only
   * form that could make a new one.
   */
  it('does not claim to be unlocked when the vault behind the key is gone', async () => {
    const { vaultStatus, createVault, forgetEnvelope } = await freshVault()

    createVault('a-good-long-passphrase')
    forgetEnvelope()

    const status = vaultStatus()
    expect(status.exists).toBe(false)
    expect(status.unlocked).toBe(false)
    expect(status.fingerprint).toBeNull()
  })
})
