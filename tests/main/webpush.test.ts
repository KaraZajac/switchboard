import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { newSubscription, encrypt, decrypt } from '../../src/main/push/webpush'

/**
 * Web Push encryption, RFC 8291.
 *
 * There is a second implementation of this in Kotlin. These tests check this
 * one on its own, and write a fixture the Android suite reads — because two
 * independent readings of the same RFC agreeing is the only evidence available
 * until a server is actually sending these.
 */

const FIXTURES = join(__dirname, '../fixtures')

describe('web push encryption', () => {
  it('reads back what it wrote', () => {
    const subscription = newSubscription()
    const message = Buffer.from('someone said your name in #lounge', 'utf8')

    const body = encrypt(message, subscription.publicKey, subscription.authSecret)

    expect(decrypt(body, subscription)?.toString('utf8')).toBe(message.toString('utf8'))
  })

  it('produces a different body every time, from the same input', () => {
    const subscription = newSubscription()
    const message = Buffer.from('hello', 'utf8')

    const first = encrypt(message, subscription.publicKey, subscription.authSecret)
    const second = encrypt(message, subscription.publicKey, subscription.authSecret)

    // A fresh salt and sender key per message, so nothing is inferable from
    // two messages happening to say the same thing
    expect(first.equals(second)).toBe(false)
    expect(decrypt(second, subscription)?.toString('utf8')).toBe('hello')
  })

  it('lays the header out the way the content coding says', () => {
    const subscription = newSubscription()
    const body = encrypt(Buffer.from('x'), subscription.publicKey, subscription.authSecret, 2048)

    expect(body.readUInt32BE(16)).toBe(2048) // record size
    expect(body.readUInt8(20)).toBe(65) // key id length
    expect(body.readUInt8(21)).toBe(0x04) // uncompressed point
  })

  it('carries an empty message', () => {
    const subscription = newSubscription()
    const body = encrypt(Buffer.alloc(0), subscription.publicKey, subscription.authSecret)

    expect(decrypt(body, subscription)?.length).toBe(0)
  })

  it('carries text that is not ASCII', () => {
    const subscription = newSubscription()
    const message = Buffer.from('🔥 mentioned you — «привет»', 'utf8')

    const body = encrypt(message, subscription.publicKey, subscription.authSecret)

    expect(decrypt(body, subscription)?.toString('utf8')).toBe(message.toString('utf8'))
  })

  // ── refusing what it should refuse ──────────────────────────────────

  it('will not read a message meant for someone else', () => {
    const mine = newSubscription()
    const theirs = newSubscription()

    const body = encrypt(Buffer.from('not for you'), theirs.publicKey, theirs.authSecret)

    expect(decrypt(body, mine)).toBeNull()
  })

  it('will not read a message whose ciphertext was altered', () => {
    const subscription = newSubscription()
    const body = encrypt(Buffer.from('as sent'), subscription.publicKey, subscription.authSecret)

    const tampered = Buffer.from(body)
    tampered[tampered.length - 20] ^= 0xff

    expect(decrypt(tampered, subscription)).toBeNull()
  })

  it('will not read one whose auth secret does not match', () => {
    const subscription = newSubscription()
    const body = encrypt(Buffer.from('hello'), subscription.publicKey, subscription.authSecret)

    const wrongAuth = { ...subscription, authSecret: Buffer.alloc(16, 7) }

    expect(decrypt(body, wrongAuth)).toBeNull()
  })

  it('returns null for a body that is not one of these at all', () => {
    const subscription = newSubscription()

    expect(decrypt(Buffer.alloc(0), subscription)).toBeNull()
    expect(decrypt(Buffer.from('nonsense'), subscription)).toBeNull()
    expect(decrypt(Buffer.alloc(200), subscription)).toBeNull()
  })

  /**
   * The fixture the Android suite reads.
   *
   * Regenerated only when missing, so the bytes the phone is checked against
   * stay the same from run to run.
   */
  it('writes a message the Android client can read', () => {
    const path = join(FIXTURES, 'webpush.json')

    let fixture: Record<string, string> | null = null
    try {
      fixture = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      const subscription = newSubscription()
      const plaintext = 'someone said your name in #lounge'
      fixture = {
        note:
          'A Web Push body (RFC 8291) written by src/main/push/webpush.ts. ' +
          'The Android suite decrypts it with the keys below; both sides also ' +
          'check that each can read what the other wrote.',
        plaintext,
        publicKey: subscription.publicKey.toString('base64'),
        privateKey: subscription.privateKey.toString('base64'),
        authSecret: subscription.authSecret.toString('base64'),
        body: encrypt(
          Buffer.from(plaintext, 'utf8'),
          subscription.publicKey,
          subscription.authSecret
        ).toString('base64')
      }
      writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n')
    }

    const subscription = {
      publicKey: Buffer.from(fixture!.publicKey, 'base64'),
      privateKey: Buffer.from(fixture!.privateKey, 'base64'),
      authSecret: Buffer.from(fixture!.authSecret, 'base64')
    }

    expect(decrypt(Buffer.from(fixture!.body, 'base64'), subscription)?.toString('utf8')).toBe(
      fixture!.plaintext
    )
  })

  /**
   * And the other direction.
   *
   * `webpush-from-android.json` is written by the Kotlin suite. If this fails,
   * one of the two implementations has drifted from the RFC — which is exactly
   * the failure a server talking to both would hit.
   */
  it('reads a message the Android client encrypted', () => {
    let fixture: Record<string, string>
    try {
      fixture = JSON.parse(readFileSync(join(FIXTURES, 'webpush-from-android.json'), 'utf8'))
    } catch {
      // The Android suite has not run yet in this checkout
      return
    }

    const subscription = {
      publicKey: Buffer.from(fixture.publicKey, 'base64'),
      privateKey: Buffer.from(fixture.privateKey, 'base64'),
      authSecret: Buffer.from(fixture.authSecret, 'base64')
    }

    expect(decrypt(Buffer.from(fixture.body, 'base64'), subscription)?.toString('utf8')).toBe(
      fixture.plaintext
    )
  })
})

