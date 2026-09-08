import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The module imports electron only for the default backend, which the tests
// replace — stub it so importing does not need an Electron runtime.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
    getSelectedStorageBackend: () => 'basic_text'
  }
}))

const {
  encryptSecret,
  decryptSecret,
  isPlaintextSecret,
  secretsProtected,
  secretsBackendDescription,
  setSecretBackend
} = await import('../../src/main/storage/secrets')

/** Reversible stand-in for the OS keystore */
function fakeBackend(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isAvailable: () => true,
    encrypt: (plain: string) => Buffer.from(`sealed:${plain}`),
    decrypt: (data: Buffer) => {
      const text = data.toString()
      if (!text.startsWith('sealed:')) throw new Error('not ours')
      return text.slice('sealed:'.length)
    },
    backendName: () => 'gnome-libsecret',
    ...overrides
  }
}

beforeEach(() => {
  setSecretBackend(fakeBackend())
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  setSecretBackend(null)
  vi.restoreAllMocks()
})

describe('credential encryption', () => {
  it('round-trips a password', () => {
    const stored = encryptSecret('hunter2')
    expect(stored).not.toBeNull()
    expect(stored).not.toContain('hunter2')
    expect(decryptSecret(stored)).toBe('hunter2')
  })

  it('marks stored values so they can be recognised', () => {
    expect(encryptSecret('hunter2')).toMatch(/^sb\.enc\.v1:/)
  })

  it('treats empty values as nothing to store', () => {
    expect(encryptSecret('')).toBeNull()
    expect(encryptSecret(null)).toBeNull()
    expect(encryptSecret(undefined)).toBeNull()
    expect(decryptSecret(null)).toBeNull()
    expect(decryptSecret('')).toBeNull()
  })

  it('does not double-encrypt', () => {
    const once = encryptSecret('hunter2')
    expect(encryptSecret(once)).toBe(once)
  })

  it('reads back legacy plaintext unchanged', () => {
    expect(decryptSecret('plain-old-password')).toBe('plain-old-password')
    expect(isPlaintextSecret('plain-old-password')).toBe(true)
    expect(isPlaintextSecret(encryptSecret('hunter2'))).toBe(false)
    expect(isPlaintextSecret(null)).toBe(false)
  })

  it('returns null rather than garbage when the key is gone', () => {
    const stored = encryptSecret('hunter2')
    setSecretBackend(
      fakeBackend({
        decrypt: () => {
          throw new Error('keyring reset')
        }
      })
    )
    expect(decryptSecret(stored)).toBeNull()
  })

  it('falls back to plaintext, loudly, when no keystore exists', () => {
    setSecretBackend(fakeBackend({ isAvailable: () => false }))
    expect(encryptSecret('hunter2')).toBe('hunter2')
    expect(console.warn).toHaveBeenCalledOnce()
    expect(secretsProtected()).toBe(false)
    expect(secretsBackendDescription()).toMatch(/unencrypted/)
  })

  it('reports Linux basic_text as unprotected', () => {
    setSecretBackend(fakeBackend({ backendName: () => 'basic_text' }))
    expect(secretsProtected()).toBe(false)
    expect(secretsBackendDescription()).toMatch(/not encrypted/)
  })

  it('reports a real keyring as protected', () => {
    expect(secretsProtected()).toBe(true)
    expect(secretsBackendDescription()).toBe('gnome-libsecret')
  })
})
