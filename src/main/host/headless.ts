import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { Host, SecretStore } from './index'
import { SERVER_PRIORITY } from '../session/coordinator'

/**
 * The machine, for a Switchboard with no window.
 *
 * Everything the engine needs from a desktop, supplied without Electron: a
 * directory, somewhere to keep secrets, and the admission that nobody is
 * sitting here to be idle.
 */

/** `$SWITCHBOARD_DATA`, else the XDG data directory, else `~/.switchboard` */
export function headlessDataDir(): string {
  const explicit = process.env['SWITCHBOARD_DATA']
  if (explicit) return explicit

  const xdg = process.env['XDG_DATA_HOME']
  if (xdg) return path.join(xdg, 'switchboard')

  return path.join(os.homedir(), '.local', 'share', 'switchboard')
}

/**
 * Secrets, without an OS keychain.
 *
 * A key file beside the data, readable only by this account, and AES-256-GCM
 * under it. This is weaker than a desktop keychain and the difference is worth
 * stating plainly: a keychain is locked when the session is, while this is
 * readable by anything running as this user the moment the machine is on.
 *
 * It is the right trade for what this is. A headless instance exists to stay
 * connected while nobody is logged in, so there is no session to unlock and
 * nothing to type a passphrase into; a key it cannot read unattended is a key
 * that stops it doing its job. What it does buy is real: the database and the
 * saved passwords are not readable from a stolen disk, a backup, or a copied
 * volume, which is what encryption at rest is for.
 */
export function fileSecretStore(dataDir: string): SecretStore {
  const keyFile = path.join(dataDir, 'headless.key')

  const key = (): Buffer => {
    if (fs.existsSync(keyFile)) {
      const stored = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64')
      if (stored.length === 32) return stored
      throw new Error(`${keyFile} is not a 32-byte key`)
    }

    fs.mkdirSync(dataDir, { recursive: true })
    const fresh = randomBytes(32)
    // Written before anything can read it, rather than written and chmod-ed
    fs.writeFileSync(keyFile, fresh.toString('base64'), { mode: 0o600 })
    console.info(`Made a key at ${keyFile}. Back it up with the data, or the data is lost.`)
    return fresh
  }

  return {
    available: () => {
      try {
        key()
        return true
      } catch (err) {
        console.error('No usable key:', err)
        return false
      }
    },

    encrypt: (plain) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key(), iv)
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      // iv | tag | ciphertext, so decrypt knows where each begins
      return Buffer.concat([iv, cipher.getAuthTag(), body])
    },

    decrypt: (data) => {
      const iv = data.subarray(0, 12)
      const tag = data.subarray(12, 28)
      const decipher = createDecipheriv('aes-256-gcm', key(), iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
    },

    describe: () => 'key file'
  }
}

export function headlessHost(dataDir = headlessDataDir()): Host {
  return {
    dataDir: () => dataDir,
    secrets: fileSecretStore(dataDir),
    // Nobody is sitting here. A headless instance is not away, it is not a
    // person, and marking it away would mark you away everywhere.
    idleSeconds: () => null,
    fetch: globalThis.fetch,

    // Above a desktop and a phone both. This is the machine that does not
    // close, so it is the one that holds the connections.
    sessionPriority: () => SERVER_PRIORITY
  }
}
