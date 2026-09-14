import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Keeping the shared config open across restarts.
 *
 * The passphrase is typed once and derives a key that lived only in memory, so
 * every restart left the desktop with a locked vault — and a locked vault
 * cannot be resealed or adopted. Nothing said so: servers, settings, profiles
 * and channels simply stopped reaching the phone until somebody happened to
 * open Settings and type the passphrase again. The phone has never had this
 * problem, because it offers to hold its key in the hardware keystore.
 *
 * This is the same offer, wrapped by the same OS keychain that already holds
 * the database key — and the database is where those server passwords are
 * kept anyway, so a key beside it is no wider a door than the one already
 * there. What it protects against is the disk, not the session: anything
 * running as the user can ask the keychain too.
 */

const KEY_FILE = 'vault.key'

/**
 * Where the wrapped key lives, or null when there is no app to ask.
 *
 * Null happens in tests, which exercise the vault without Electron. Every
 * caller treats it as "no key kept", which is the truthful answer there.
 */
function keyPath(): string | null {
  try {
    return path.join(app.getPath('userData'), KEY_FILE)
  } catch {
    return null
  }
}

/** Whether the OS will wrap a key for us — false on a box with no keyring */
export function keychainAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** Hold the derived key, so the next launch opens the vault without asking */
export function rememberVaultKey(key: Buffer): boolean {
  if (!keychainAvailable()) return false

  const file = keyPath()
  if (!file) return false

  try {
    const wrapped = safeStorage.encryptString(key.toString('base64'))
    const temporary = `${file}.tmp`
    const handle = fs.openSync(temporary, 'w')
    try {
      fs.writeFileSync(handle, wrapped)
      fs.fsyncSync(handle)
    } finally {
      fs.closeSync(handle)
    }
    fs.renameSync(temporary, file)
    return true
  } catch (err) {
    console.error('Could not keep the shared config unlocked:', err)
    return false
  }
}

/** The key from last time, or null when there is none or it will not unwrap */
export function recallVaultKey(): Buffer | null {
  if (!keychainAvailable()) return null

  const file = keyPath()
  if (!file || !fs.existsSync(file)) return null

  try {
    const key = Buffer.from(safeStorage.decryptString(fs.readFileSync(file)), 'base64')
    if (key.length !== 32) throw new Error('the stored key is the wrong length')
    return key
  } catch (err) {
    // Not fatal, unlike the database key: the passphrase still opens it, and
    // the user is asked for it exactly as they were before.
    console.error('The kept vault key could not be unwrapped:', err)
    return null
  }
}

/** Forget it — locking on purpose has to mean locked after a restart too */
export function forgetVaultKey(): void {
  const file = keyPath()
  if (!file) return

  try {
    fs.rmSync(file, { force: true })
  } catch (err) {
    console.error('Could not forget the vault key:', err)
  }
}

/** Whether a key is being kept, for the settings panel to show */
export function vaultKeyRemembered(): boolean {
  const file = keyPath()
  if (!file) return false

  try {
    return fs.existsSync(file)
  } catch {
    return false
  }
}
