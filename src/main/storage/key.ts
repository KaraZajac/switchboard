import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'crypto'

/**
 * The key the database is encrypted with.
 *
 * Random, 32 bytes, generated once and then wrapped by the OS keychain —
 * gnome-keyring, kwallet, the macOS keychain, DPAPI — and stored beside the
 * database. The database file is then useless on its own: copying it off the
 * disk, out of a backup, or off a stolen laptop's drive gets an attacker
 * nothing without the account it belongs to.
 *
 * What this does not protect against is anything running as the user, because
 * the keychain will hand *it* the key too. That is the honest limit of
 * encryption at rest and it is worth being clear about: this is protection
 * against the disk, not against the session.
 */

const KEY_FILE = 'switchboard.key'

/** Where the wrapped key lives — beside the database, not inside it */
function keyPath(): string {
  return path.join(app.getPath('userData'), KEY_FILE)
}

/**
 * Whether the OS can actually wrap a key for us.
 *
 * On Linux this is false when no keyring is running, which is common on
 * headless boxes and minimal desktops. The caller has to decide what to do
 * about it rather than have a key silently written out in the clear.
 */
export function keychainAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/**
 * The database key, generating and storing one the first time.
 *
 * Returns null when there is no keychain to wrap it with — see
 * [keychainAvailable]. Storing an unwrapped key beside the database it unlocks
 * would be theatre.
 */
export function databaseKey(): Buffer | null {
  if (!keychainAvailable()) return null

  const file = keyPath()

  if (fs.existsSync(file)) {
    try {
      const unwrapped = safeStorage.decryptString(fs.readFileSync(file))
      const key = Buffer.from(unwrapped, 'base64')
      if (key.length !== 32) throw new Error('the stored key is the wrong length')
      return key
    } catch (err) {
      // A key we cannot unwrap is worse than none: the database it belongs to
      // is unreadable, and silently making a new one would look like the
      // history had been deleted.
      console.error('The database key could not be unwrapped:', err)
      throw new Error('The database key could not be unwrapped by the keychain')
    }
  }

  const key = randomBytes(32)
  const wrapped = safeStorage.encryptString(key.toString('base64'))

  // Write it the way anything important gets written: temp, flush, rename.
  const temporary = `${file}.tmp`
  const handle = fs.openSync(temporary, 'w')
  try {
    fs.writeFileSync(handle, wrapped)
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  fs.renameSync(temporary, file)

  return key
}

/**
 * The pragma that unlocks the database with this key.
 *
 * `hexkey` rather than `key`, because the bytes here are already a key: `key`
 * would treat them as a passphrase and derive a second one from them, and the
 * blob-literal form SQLCipher uses is not something SQLite's pragma parser
 * accepts — it is a syntax error, not a fallback.
 */
export function keyPragma(key: Buffer): string {
  return `hexkey = '${key.toString('hex')}'`
}
