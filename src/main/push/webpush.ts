import { createECDH, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Web Push message encryption — RFC 8291, over the aes128gcm content coding of
 * RFC 8188.
 *
 * A device hands a push service an endpoint and two keys; whoever sends to it
 * encrypts to those keys, and the service forwards an opaque blob. Nobody in
 * between can read the message — which is the whole reason to do this rather
 * than post the text through somebody's notification API.
 *
 * There is a second implementation of exactly this in Kotlin, and the tests
 * check that each can read what the other wrote. Two independent readings of
 * the same RFC agreeing is the only evidence available until a server is
 * actually sending these.
 */

const CURVE = 'prime256v1'
const POINT_BYTES = 65
const SALT_BYTES = 16
const KEY_BYTES = 16
const NONCE_BYTES = 12

export interface Subscription {
  /** The `p256dh` a sender encrypts to */
  publicKey: Buffer
  /** The private half, which never leaves the device that made it */
  privateKey: Buffer
  /** The `auth` secret, which salts the key derivation */
  authSecret: Buffer
}

/** A fresh subscription — one per device, kept while it stays registered */
export function newSubscription(): Subscription {
  const ecdh = createECDH(CURVE)
  ecdh.generateKeys()
  return {
    publicKey: ecdh.getPublicKey(),
    privateKey: ecdh.getPrivateKey(),
    authSecret: randomBytes(16)
  }
}

/** RFC 8188 §2.2: the info string for a derived value */
function contentEncoding(name: string): Buffer {
  return Buffer.concat([Buffer.from(`Content-Encoding: ${name}`, 'ascii'), Buffer.from([0])])
}

/** HKDF-SHA256, extract then expand. Every output here fits in one block. */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  if (length > 32) throw new Error('one block is all this needs')
  const prk = createHmac('sha256', salt).update(ikm).digest()
  return createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, length)
}

/**
 * The content key and nonce for one message.
 *
 * RFC 8291 §3.4 — the auth secret salts the first extract, and both public
 * keys are bound into the info, so a derived key cannot be replayed against a
 * different subscription.
 */
function derive(
  shared: Buffer,
  authSecret: Buffer,
  recipientPublic: Buffer,
  senderPublic: Buffer,
  salt: Buffer
): { key: Buffer; nonce: Buffer } {
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info', 'ascii'),
    Buffer.from([0]),
    recipientPublic,
    senderPublic
  ])
  const ikm = hkdf(authSecret, shared, keyInfo, 32)

  return {
    key: hkdf(salt, ikm, contentEncoding('aes128gcm'), KEY_BYTES),
    nonce: hkdf(salt, ikm, contentEncoding('nonce'), NONCE_BYTES)
  }
}

/** Encrypt one message to a subscription's public key */
export function encrypt(
  plaintext: Buffer,
  recipientPublicKey: Buffer,
  authSecret: Buffer,
  recordSize = 4096
): Buffer {
  const sender = createECDH(CURVE)
  sender.generateKeys()
  const senderPublic = sender.getPublicKey()
  const salt = randomBytes(SALT_BYTES)

  const shared = sender.computeSecret(recipientPublicKey)
  const { key, nonce } = derive(shared, authSecret, recipientPublicKey, senderPublic, salt)

  const cipher = createCipheriv('aes-128-gcm', key, nonce)
  // One record, so the delimiter is the last-record marker
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag()
  ])

  const header = Buffer.alloc(5)
  header.writeUInt32BE(recordSize, 0)
  header.writeUInt8(POINT_BYTES, 4)

  return Buffer.concat([salt, header, senderPublic, sealed])
}

/**
 * Read a push message.
 *
 * Returns null rather than throwing for anything malformed: a push body is
 * attacker-reachable and is not worth crashing over.
 */
export function decrypt(body: Buffer, subscription: Subscription): Buffer | null {
  try {
    if (body.length <= SALT_BYTES + 5) throw new Error('body too short to carry a header')

    const salt = body.subarray(0, SALT_BYTES)
    const keyIdLength = body.readUInt8(SALT_BYTES + 4)
    if (keyIdLength !== POINT_BYTES) throw new Error('sender key is not an uncompressed point')

    const keyIdAt = SALT_BYTES + 5
    const senderPublic = body.subarray(keyIdAt, keyIdAt + keyIdLength)
    const sealed = body.subarray(keyIdAt + keyIdLength)
    if (sealed.length <= 16) throw new Error('no ciphertext after the header')

    const ecdh = createECDH(CURVE)
    ecdh.setPrivateKey(subscription.privateKey)
    const shared = ecdh.computeSecret(senderPublic)

    const { key, nonce } = derive(
      shared,
      subscription.authSecret,
      subscription.publicKey,
      senderPublic,
      salt
    )

    const tag = sealed.subarray(sealed.length - 16)
    const ciphertext = sealed.subarray(0, sealed.length - 16)

    const decipher = createDecipheriv('aes-128-gcm', key, nonce)
    decipher.setAuthTag(tag)
    const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()])

    return unpad(padded)
  } catch {
    return null
  }
}

/**
 * Strip the record padding.
 *
 * A record ends with a delimiter — 0x02 on the last, 0x01 otherwise — after
 * any number of zero bytes.
 */
function unpad(padded: Buffer): Buffer {
  let end = padded.length - 1
  while (end >= 0 && padded[end] === 0) end--
  if (end < 0) throw new Error('no delimiter in the record')
  if (padded[end] !== 0x02 && padded[end] !== 0x01) {
    throw new Error('record does not end with a delimiter')
  }
  return padded.subarray(0, end)
}
