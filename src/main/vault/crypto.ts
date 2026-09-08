import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual
} from 'crypto'

/**
 * The crypto behind the shared vault.
 *
 * Deliberately built from primitives that exist natively on both sides —
 * PBKDF2-HMAC-SHA256 and AES-256-GCM are in Node's `crypto` and in Android's
 * `javax.crypto`. Argon2id would be a stronger KDF, but it would mean a native
 * dependency on the desktop and a bundled implementation on the phone, and a
 * vault only one device can open is worse than a slightly cheaper KDF.
 *
 * The envelope's metadata (version, timestamp, author) travels in the clear so
 * two devices can compare vaults without unlocking them — so it is fed to
 * AES-GCM as additional authenticated data, and a peer that rewrites the
 * version to force a rollback fails to open rather than succeeding quietly.
 */

export const VAULT_FORMAT = 1
export const KDF_NAME = 'pbkdf2-sha256'

/** OWASP's 2023 floor for PBKDF2-HMAC-SHA256; ~250ms on a laptop, ~1s on a phone */
export const KDF_ITERATIONS = 600_000

export interface VaultMeta {
  /** Monotonic content version, so the newer vault wins a sync */
  version: number
  updatedAt: string
  /** Which device sealed it, for the UI and for conflict messages */
  updatedBy: string
}

export interface VaultEnvelope extends VaultMeta {
  format: number
  kdf: { name: string; iterations: number; salt: string }
  iv: string
  ciphertext: string
  tag: string
}

export class VaultLockedError extends Error {
  constructor(message = 'The vault could not be opened with that passphrase') {
    super(message)
    this.name = 'VaultLockedError'
  }
}

export function generateSalt(): Buffer {
  return randomBytes(16)
}

export function deriveKey(
  passphrase: string,
  salt: Buffer,
  iterations = KDF_ITERATIONS
): Buffer {
  if (passphrase.length === 0) throw new Error('A vault passphrase cannot be empty')
  return pbkdf2Sync(passphrase.normalize('NFKC'), salt, iterations, 32, 'sha256')
}

/** The bytes bound into the ciphertext so the visible metadata cannot be edited */
function associatedData(meta: VaultMeta, format: number): Buffer {
  return Buffer.from(`${format}:${meta.version}:${meta.updatedAt}:${meta.updatedBy}`, 'utf8')
}

export function sealVault(
  payload: unknown,
  key: Buffer,
  salt: Buffer,
  meta: VaultMeta,
  iterations = KDF_ITERATIONS
): VaultEnvelope {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(associatedData(meta, VAULT_FORMAT))

  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final()
  ])

  return {
    format: VAULT_FORMAT,
    kdf: { name: KDF_NAME, iterations, salt: salt.toString('base64') },
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ...meta
  }
}

export function openVault<T>(envelope: VaultEnvelope, key: Buffer): T {
  if (envelope.format !== VAULT_FORMAT) {
    throw new VaultLockedError(`Unsupported vault format ${envelope.format}`)
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64')
    )
    decipher.setAAD(associatedData(envelope, envelope.format))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ])

    return JSON.parse(plaintext.toString('utf8')) as T
  } catch {
    // A wrong passphrase and a tampered envelope both land here, and telling
    // them apart is not something to hand back to a caller.
    throw new VaultLockedError()
  }
}

/** Derive the key for an existing envelope, using the salt it carries */
export function deriveKeyFor(envelope: VaultEnvelope, passphrase: string): Buffer {
  return deriveKey(
    passphrase,
    Buffer.from(envelope.kdf.salt, 'base64'),
    envelope.kdf.iterations
  )
}

/**
 * A short fingerprint of the vault key.
 *
 * Two devices can compare these to see whether they share a passphrase without
 * either of them sending it, which is what the pairing UI shows.
 */
export function keyFingerprint(key: Buffer): string {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from('switchboard-vault-fingerprint'), key]))
    .digest('hex')
    .slice(0, 12)
}

/** Constant-time compare for fingerprints coming off the wire */
export function fingerprintsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
