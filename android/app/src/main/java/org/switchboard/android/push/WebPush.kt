package org.switchboard.android.push

import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Web Push message encryption — RFC 8291, over the aes128gcm content coding of
 * RFC 8188.
 *
 * The phone hands a push service an endpoint and two keys; the IRC server
 * encrypts to those keys and gives the result to that service, which forwards
 * an opaque blob. Nobody in the middle — not the push service, not whoever
 * runs it — can read what the message says. That property is the whole reason
 * to do this rather than post the text through somebody's notification API.
 *
 * Key agreement is ECDH on P-256; the rest is HKDF-SHA256 and AES-128-GCM.
 * None of it is negotiable, which is why this is written against the RFC and
 * checked against an independent implementation rather than against whatever
 * one server happens to send.
 */
object WebPush {

    private const val CURVE = "secp256r1"
    private const val UNCOMPRESSED_POINT = 0x04.toByte()

    /** An uncompressed P-256 point: 0x04, then 32 bytes of X and 32 of Y */
    private const val POINT_BYTES = 65
    private const val COORD_BYTES = 32

    private const val SALT_BYTES = 16
    private const val KEY_BYTES = 16
    private const val NONCE_BYTES = 12
    private const val TAG_BITS = 128

    /**
     * The subscription's own keys.
     *
     * [publicKey] is the `p256dh` a server encrypts to and [authSecret] the
     * `auth` that salts the derivation. Both are given to the server; the
     * private half never leaves the device.
     */
    class Subscription(val keyPair: KeyPair, val authSecret: ByteArray) {
        val publicKey: ByteArray get() = encodePoint(keyPair.public as ECPublicKey)
    }

    /** A fresh subscription — one per device, kept while it stays registered */
    fun newSubscription(random: SecureRandom = SecureRandom()): Subscription {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec(CURVE), random)
        val auth = ByteArray(16).also(random::nextBytes)
        return Subscription(generator.generateKeyPair(), auth)
    }

    /**
     * Read a push message.
     *
     * The body carries everything needed to derive the key except our own
     * private half: the salt, the record size, and the sender's public key.
     *
     * Returns null rather than throwing for anything malformed. A push body is
     * attacker-reachable and arrives on a background thread; it is not worth
     * crashing a notification over.
     */
    fun decrypt(body: ByteArray, subscription: Subscription): ByteArray? = runCatching {
        require(body.size > SALT_BYTES + 4 + 1) { "body too short to carry a header" }

        val salt = body.copyOfRange(0, SALT_BYTES)
        val keyIdLength = body[SALT_BYTES + 4].toInt() and 0xFF
        require(keyIdLength == POINT_BYTES) { "sender key is not an uncompressed P-256 point" }

        val keyIdAt = SALT_BYTES + 5
        require(body.size > keyIdAt + keyIdLength) { "no ciphertext after the header" }
        val senderPublic = body.copyOfRange(keyIdAt, keyIdAt + keyIdLength)
        val ciphertext = body.copyOfRange(keyIdAt + keyIdLength, body.size)

        val shared = agree(subscription.keyPair.private, decodePoint(senderPublic))

        // RFC 8291 §3.4. The auth secret salts the first extract, and both
        // public keys are bound into the info, so a derived key cannot be
        // replayed against a different subscription.
        val keyInfo = "WebPush: info".toByteArray(Charsets.US_ASCII) + byteArrayOf(0) +
            subscription.publicKey + senderPublic
        val ikm = hkdf(salt = subscription.authSecret, ikm = shared, info = keyInfo, length = 32)

        val cek = hkdf(salt, ikm, contentEncoding("aes128gcm"), KEY_BYTES)
        val nonce = hkdf(salt, ikm, contentEncoding("nonce"), NONCE_BYTES)

        unpad(open(ciphertext, cek, nonce))
    }.getOrNull()

    /**
     * Encrypt a push message.
     *
     * Here so that the decryption above has something to be checked against,
     * and so the shared corpus can be produced from either side.
     */
    fun encrypt(
        plaintext: ByteArray,
        recipientPublicKey: ByteArray,
        authSecret: ByteArray,
        random: SecureRandom = SecureRandom(),
        recordSize: Int = 4096
    ): ByteArray {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec(CURVE), random)
        val sender = generator.generateKeyPair()
        val senderPublic = encodePoint(sender.public as ECPublicKey)

        val salt = ByteArray(SALT_BYTES).also(random::nextBytes)
        val shared = agree(sender.private, decodePoint(recipientPublicKey))

        val keyInfo = "WebPush: info".toByteArray(Charsets.US_ASCII) + byteArrayOf(0) +
            recipientPublicKey + senderPublic
        val ikm = hkdf(salt = authSecret, ikm = shared, info = keyInfo, length = 32)

        val cek = hkdf(salt, ikm, contentEncoding("aes128gcm"), KEY_BYTES)
        val nonce = hkdf(salt, ikm, contentEncoding("nonce"), NONCE_BYTES)

        // One record, so the delimiter is the last-record marker
        val sealed = seal(plaintext + byteArrayOf(0x02), cek, nonce)

        return salt + intToBytes(recordSize) + byteArrayOf(POINT_BYTES.toByte()) +
            senderPublic + sealed
    }

    // ── the pieces ────────────────────────────────────────────────────

    /** RFC 8188 §2.2: the info string for a derived value */
    private fun contentEncoding(name: String): ByteArray =
        "Content-Encoding: $name".toByteArray(Charsets.US_ASCII) + byteArrayOf(0)

    private fun agree(privateKey: PrivateKey, publicKey: PublicKey): ByteArray =
        KeyAgreement.getInstance("ECDH").run {
            init(privateKey)
            doPhase(publicKey, true)
            generateSecret()
        }

    /** HKDF-SHA256, extract then expand. Every output here fits in one block. */
    private fun hkdf(salt: ByteArray, ikm: ByteArray, info: ByteArray, length: Int): ByteArray {
        require(length <= 32) { "one block is all this needs" }
        val prk = hmac(salt, ikm)
        return hmac(prk, info + byteArrayOf(1)).copyOf(length)
    }

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal(data)
        }

    private fun open(ciphertext: ByteArray, key: ByteArray, nonce: ByteArray): ByteArray =
        Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, nonce))
            doFinal(ciphertext)
        }

    private fun seal(plaintext: ByteArray, key: ByteArray, nonce: ByteArray): ByteArray =
        Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, nonce))
            doFinal(plaintext)
        }

    /**
     * Strip the record padding.
     *
     * A record ends with a delimiter — 0x02 on the last, 0x01 otherwise —
     * after any number of zero bytes.
     */
    private fun unpad(padded: ByteArray): ByteArray {
        var end = padded.size - 1
        while (end >= 0 && padded[end] == 0.toByte()) end--
        require(end >= 0) { "no delimiter in the record" }
        require(padded[end] == 0x02.toByte() || padded[end] == 0x01.toByte()) {
            "record does not end with a delimiter"
        }
        return padded.copyOfRange(0, end)
    }

    private fun intToBytes(value: Int): ByteArray = byteArrayOf(
        (value ushr 24).toByte(),
        (value ushr 16).toByte(),
        (value ushr 8).toByte(),
        value.toByte()
    )

    /** A public key as the uncompressed point a subscription advertises */
    private fun encodePoint(key: ECPublicKey): ByteArray {
        val point = key.w
        val out = ByteArray(POINT_BYTES)
        out[0] = UNCOMPRESSED_POINT
        coordinate(point.affineX).copyInto(out, 1)
        coordinate(point.affineY).copyInto(out, 1 + COORD_BYTES)
        return out
    }

    /** Fixed width: BigInteger drops leading zeroes and adds a sign byte */
    private fun coordinate(value: BigInteger): ByteArray {
        val raw = value.toByteArray()
        return when {
            raw.size == COORD_BYTES -> raw
            raw.size > COORD_BYTES -> raw.copyOfRange(raw.size - COORD_BYTES, raw.size)
            else -> ByteArray(COORD_BYTES).also { raw.copyInto(it, COORD_BYTES - raw.size) }
        }
    }

    private fun decodePoint(encoded: ByteArray): PublicKey {
        require(encoded.size == POINT_BYTES && encoded[0] == UNCOMPRESSED_POINT) {
            "not an uncompressed P-256 point"
        }
        val x = BigInteger(1, encoded.copyOfRange(1, 1 + COORD_BYTES))
        val y = BigInteger(1, encoded.copyOfRange(1 + COORD_BYTES, POINT_BYTES))
        return KeyFactory.getInstance("EC")
            .generatePublic(ECPublicKeySpec(ECPoint(x, y), curveParameters()))
    }

    private fun curveParameters(): ECParameterSpec =
        AlgorithmParameters.getInstance("EC").run {
            init(ECGenParameterSpec(CURVE))
            getParameterSpec(ECParameterSpec::class.java)
        }
}
