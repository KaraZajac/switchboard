import * as crypto from 'crypto'
import { registerHandler } from './handlers/registry'
import { SASL_CHUNK_SIZE } from '@shared/constants'

/**
 * SASL SCRAM-SHA-256 authentication.
 *
 * Flow:
 * 1. Client sends AUTHENTICATE SCRAM-SHA-256
 * 2. Server responds AUTHENTICATE +
 * 3. Client sends client-first-message
 * 4. Server sends server-first-message (with salt, iteration count, nonce)
 * 5. Client sends client-final-message (with proof)
 * 6. Server sends server-final-message (with verifier)
 * 7. Server sends 903 (success) or 904 (failure)
 */

/** Tracks the SCRAM exchange state */
interface ScramState {
  username: string
  password: string
  clientNonce: string
  clientFirstMessageBare: string
  serverNonce?: string
  salt?: Buffer
  iterations?: number
  authMessage?: string
  step: 'client-first' | 'client-final' | 'verify' | 'done'
}

// Per-client SCRAM state (keyed by a simple counter since we handle one at a time)
let currentScram: ScramState | null = null

/**
 * Begin SCRAM-SHA-256 authentication.
 * Called when the server responds AUTHENTICATE + after we sent AUTHENTICATE SCRAM-SHA-256.
 */
export function beginScramAuth(
  client: { config: { saslUsername: string | null; saslPassword: string | null; nick: string }; connection: { sendRaw: (line: string) => void } }
): void {
  const username = client.config.saslUsername || client.config.nick
  const password = client.config.saslPassword || ''

  const clientNonce = crypto.randomBytes(24).toString('base64')
  const escapedUsername = username.replace(/=/g, '=3D').replace(/,/g, '=2C')
  const clientFirstMessageBare = `n=${escapedUsername},r=${clientNonce}`
  const clientFirstMessage = `n,,${clientFirstMessageBare}`

  currentScram = {
    username,
    password,
    clientNonce,
    clientFirstMessageBare,
    step: 'client-first'
  }

  const encoded = Buffer.from(clientFirstMessage, 'utf8').toString('base64')
  sendChunked(client.connection, encoded)
}

/**
 * Handle server challenge during SCRAM exchange.
 */
export function handleScramChallenge(
  client: { connection: { sendRaw: (line: string) => void }; events: { emit: (event: string, ...args: unknown[]) => boolean } },
  payload: string
): void {
  if (!currentScram) return

  const decoded = Buffer.from(payload, 'base64').toString('utf8')

  if (currentScram.step === 'client-first') {
    // Server-first-message: r=<nonce>,s=<salt>,i=<iterations>
    const parsed = parseServerFirst(decoded)
    if (!parsed) {
      client.events.emit('error', { code: 'SCRAM', command: 'SASL', message: 'Invalid server-first-message' })
      currentScram = null
      return
    }

    // Verify server nonce starts with our client nonce
    if (!parsed.nonce.startsWith(currentScram.clientNonce)) {
      client.events.emit('error', { code: 'SCRAM', command: 'SASL', message: 'Server nonce mismatch' })
      currentScram = null
      return
    }

    currentScram.serverNonce = parsed.nonce
    currentScram.salt = parsed.salt
    currentScram.iterations = parsed.iterations
    currentScram.step = 'client-final'

    // Compute client proof
    const clientFinalMessageWithoutProof = `c=${Buffer.from('n,,').toString('base64')},r=${parsed.nonce}`
    const authMessage = `${currentScram.clientFirstMessageBare},${decoded},${clientFinalMessageWithoutProof}`
    currentScram.authMessage = authMessage

    const saltedPassword = hi(currentScram.password, parsed.salt, parsed.iterations)
    const clientKey = hmac(saltedPassword, 'Client Key')
    const storedKey = hash(clientKey)
    const clientSignature = hmac(storedKey, authMessage)
    const clientProof = xorBuffers(clientKey, clientSignature)

    const clientFinalMessage = `${clientFinalMessageWithoutProof},p=${clientProof.toString('base64')}`
    const encoded = Buffer.from(clientFinalMessage, 'utf8').toString('base64')
    sendChunked(client.connection, encoded)

  } else if (currentScram.step === 'client-final') {
    // Server-final-message: v=<server-signature>
    const match = decoded.match(/^v=(.+)$/)
    if (!match) {
      client.events.emit('error', { code: 'SCRAM', command: 'SASL', message: 'Invalid server-final-message' })
      currentScram = null
      return
    }

    // Verify server signature
    const serverSignature = Buffer.from(match[1], 'base64')
    const saltedPassword = hi(currentScram.password, currentScram.salt!, currentScram.iterations!)
    const serverKey = hmac(saltedPassword, 'Server Key')
    const expectedSignature = hmac(serverKey, currentScram.authMessage!)

    if (!crypto.timingSafeEqual(serverSignature, expectedSignature)) {
      client.events.emit('error', { code: 'SCRAM', command: 'SASL', message: 'Server signature verification failed' })
      currentScram = null
      return
    }

    currentScram.step = 'done'
    currentScram = null
    // Server will send 903 next — handled by sasl.ts
  }
}

/** Reset SCRAM state (e.g., on disconnect) */
export function resetScramState(): void {
  currentScram = null
}

/** Check if we're in the middle of a SCRAM exchange */
export function isScramInProgress(): boolean {
  return currentScram !== null
}

// ── SCRAM Crypto Primitives ────────────────────────────────────────

/** PBKDF2 (Hi) — salted password derivation */
function hi(password: string, salt: Buffer, iterations: number): Buffer {
  return crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256')
}

/** HMAC-SHA-256 */
function hmac(key: Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

/** SHA-256 hash */
function hash(data: Buffer): Buffer {
  return crypto.createHash('sha256').update(data).digest()
}

/** XOR two buffers */
function xorBuffers(a: Buffer, b: Buffer): Buffer {
  const result = Buffer.alloc(a.length)
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i]
  }
  return result
}

/** Parse server-first-message */
function parseServerFirst(msg: string): { nonce: string; salt: Buffer; iterations: number } | null {
  const parts: Record<string, string> = {}
  for (const segment of msg.split(',')) {
    const key = segment[0]
    if (segment[1] !== '=') continue
    parts[key] = segment.slice(2)
  }

  if (!parts['r'] || !parts['s'] || !parts['i']) return null

  return {
    nonce: parts['r'],
    salt: Buffer.from(parts['s'], 'base64'),
    iterations: parseInt(parts['i'], 10)
  }
}

/** Send chunked AUTHENTICATE payload */
function sendChunked(connection: { sendRaw: (line: string) => void }, encoded: string): void {
  for (let i = 0; i < encoded.length; i += SASL_CHUNK_SIZE) {
    connection.sendRaw(`AUTHENTICATE ${encoded.slice(i, i + SASL_CHUNK_SIZE)}`)
  }
  if (encoded.length % SASL_CHUNK_SIZE === 0) {
    connection.sendRaw('AUTHENTICATE +')
  }
}
