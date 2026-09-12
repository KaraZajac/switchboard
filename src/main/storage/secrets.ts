import { safeStorage } from 'electron'

/**
 * Encryption for the few values that must not sit on disk in the clear:
 * server passwords, SASL passwords, and the identify command (which is
 * conventionally "/msg NickServ IDENTIFY <password>").
 *
 * The key belongs to the OS, not to us — Keychain on macOS, DPAPI on Windows,
 * kwallet or gnome-libsecret on Linux. Values are stored as
 * "sb.enc.v1:<base64>", so a stored value carries whether it is encrypted and
 * older plaintext rows keep working until they are rewritten.
 */

const PREFIX = 'sb.enc.v1:'

/** Swappable so the encoding rules can be tested without an Electron runtime */
export interface SecretBackend {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
  /** Name of the OS store in use, for diagnostics */
  backendName(): string
}

const electronBackend: SecretBackend = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (data) => safeStorage.decryptString(data),
  backendName: () =>
    process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform
}

let backend: SecretBackend = electronBackend

/** Test seam — pass nothing to restore the real one */
export function setSecretBackend(next: SecretBackend | null): void {
  backend = next ?? electronBackend
  warnedUnavailable = false
}

let warnedUnavailable = false

/**
 * Whether stored secrets are actually protected.
 *
 * On Linux with no keyring, Electron falls back to a hardcoded key it calls
 * "basic_text" — that is obfuscation, not encryption, and the user deserves to
 * be told rather than reassured.
 */
export function secretsProtected(): boolean {
  if (!backend.isAvailable()) return false
  return backend.backendName() !== 'basic_text'
}

/** One-line description of where the key lives, for settings and logs */
export function secretsBackendDescription(): string {
  if (!backend.isAvailable()) return 'unavailable — credentials are stored unencrypted'
  const name = backend.backendName()
  if (name === 'basic_text') {
    return 'no system keyring found — credentials are only obfuscated, not encrypted'
  }
  return name
}

/** Encrypt a credential for storage. Empty values stay empty. */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === '') return null
  if (plain.startsWith(PREFIX)) return plain // already encrypted

  if (!backend.isAvailable()) {
    if (!warnedUnavailable) {
      warnedUnavailable = true
      console.warn(
        'Secret storage is unavailable on this system — credentials are being stored unencrypted'
      )
    }
    return plain
  }

  try {
    return PREFIX + backend.encrypt(plain).toString('base64')
  } catch (err) {
    console.error('Failed to encrypt a credential; storing it unencrypted:', err)
    return plain
  }
}

/**
 * Decrypt a stored credential.
 *
 * Returns null when a value was encrypted but cannot be read back (a moved
 * profile, a reset keyring). Connecting with a silently empty password would
 * look like a server-side auth failure, so this is logged loudly instead.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  return readSecret(stored).value
}

/**
 * The same, and whether the value was there but unreadable.
 *
 * Null on its own cannot tell "nothing was saved" from "something was saved
 * and this machine can no longer read it", and the difference is the whole
 * story: the first means connect without a password, the second means stop and
 * say so. Sending an empty one instead produced a 904 and a banner blaming the
 * server for refusing a password we never had.
 */
export function readSecret(stored: string | null | undefined): {
  value: string | null
  unreadable: boolean
} {
  if (stored === null || stored === undefined || stored === '') {
    return { value: null, unreadable: false }
  }
  if (!stored.startsWith(PREFIX)) return { value: stored, unreadable: false } // legacy plaintext

  try {
    return {
      value: backend.decrypt(Buffer.from(stored.slice(PREFIX.length), 'base64')),
      unreadable: false
    }
  } catch (err) {
    console.error(
      'A stored credential could not be decrypted — it was encrypted with a key this system no longer has. Re-enter it in server settings.',
      err
    )
    return { value: null, unreadable: true }
  }
}

/** Whether a stored value still needs encrypting (used by the migration) */
export function isPlaintextSecret(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored !== '' && !stored.startsWith(PREFIX)
}
