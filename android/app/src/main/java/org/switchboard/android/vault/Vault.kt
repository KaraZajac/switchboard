package org.switchboard.android.vault

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.security.MessageDigest
import java.text.Normalizer
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The phone's half of the shared vault.
 *
 * Byte-for-byte compatible with `src/main/vault/crypto.ts` on the desktop: same
 * KDF, same cipher, same associated data, same base64. A vault sealed on either
 * device opens on the other with the passphrase the user typed on both — that is
 * the whole point of it, and the fixture tests exist to keep it true.
 */

const val VAULT_FORMAT = 1
const val KDF_NAME = "pbkdf2-sha256"

/** Matches the desktop. ~1s on a phone, which is a cost paid once per unlock. */
const val KDF_ITERATIONS = 600_000

private const val KEY_BYTES = 32
private const val GCM_TAG_BITS = 128
private const val FINGERPRINT_DOMAIN = "switchboard-vault-fingerprint"

class VaultLockedException(message: String = "The vault could not be opened with that passphrase") :
    Exception(message)

@Serializable
data class VaultKdf(val name: String, val iterations: Int, val salt: String)

/**
 * The sealed vault as it travels and as it rests.
 *
 * Everything outside `ciphertext` is visible so two devices can compare versions
 * without unlocking — and is therefore authenticated, so neither can be edited.
 */
@Serializable
data class VaultEnvelope(
    val format: Int,
    val kdf: VaultKdf,
    val iv: String,
    val ciphertext: String,
    val tag: String,
    val version: Int,
    val updatedAt: String,
    val updatedBy: String
)

object VaultCrypto {

    private val b64 = Base64.getEncoder()
    private val b64d = Base64.getDecoder()

    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    /**
     * PBKDF2-HMAC-SHA256, written out rather than taken from `SecretKeyFactory`.
     *
     * Java's `PBEKeySpec` takes a `char[]` and the platform providers disagree
     * about how those become bytes — some keep only the low byte of each char,
     * which silently produces a different key from Node's for any passphrase
     * outside ASCII. Doing the loop here means the phone and the desktop derive
     * the same key from "café" as well as from "hunter2".
     */
    fun deriveKey(passphrase: String, salt: ByteArray, iterations: Int = KDF_ITERATIONS): ByteArray {
        require(passphrase.isNotEmpty()) { "A vault passphrase cannot be empty" }

        val normalised = Normalizer.normalize(passphrase, Normalizer.Form.NFKC)
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(normalised.toByteArray(Charsets.UTF_8), "HmacSHA256"))

        val hLen = mac.macLength
        val blocks = (KEY_BYTES + hLen - 1) / hLen
        val output = ByteArray(blocks * hLen)

        for (block in 1..blocks) {
            // U1 = PRF(password, salt || INT_BE32(block))
            mac.update(salt)
            mac.update(byteArrayOf(
                (block ushr 24).toByte(),
                (block ushr 16).toByte(),
                (block ushr 8).toByte(),
                block.toByte()
            ))
            var u = mac.doFinal()
            val acc = u.copyOf()

            for (round in 2..iterations) {
                u = mac.doFinal(u)
                for (i in acc.indices) acc[i] = (acc[i].toInt() xor u[i].toInt()).toByte()
            }

            System.arraycopy(acc, 0, output, (block - 1) * hLen, hLen)
        }

        return output.copyOf(KEY_BYTES)
    }

    /** Derive using the parameters the envelope itself carries */
    fun deriveKeyFor(envelope: VaultEnvelope, passphrase: String): ByteArray =
        deriveKey(passphrase, b64d.decode(envelope.kdf.salt), envelope.kdf.iterations)

    /** Exactly the string the desktop builds — a mismatch here is an unopenable vault */
    private fun associatedData(format: Int, version: Int, updatedAt: String, updatedBy: String) =
        "$format:$version:$updatedAt:$updatedBy".toByteArray(Charsets.UTF_8)

    fun seal(
        payloadJson: String,
        key: ByteArray,
        salt: ByteArray,
        version: Int,
        updatedAt: String,
        updatedBy: String,
        iterations: Int = KDF_ITERATIONS,
        /** Test seam: the fixture generator pins this so the file stays stable */
        iv: ByteArray = ByteArray(12).also { java.security.SecureRandom().nextBytes(it) }
    ): VaultEnvelope {

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.ENCRYPT_MODE,
            SecretKeySpec(key, "AES"),
            GCMParameterSpec(GCM_TAG_BITS, iv)
        )
        cipher.updateAAD(associatedData(VAULT_FORMAT, version, updatedAt, updatedBy))

        // Java appends the tag to the ciphertext; the wire format keeps them apart
        val sealed = cipher.doFinal(payloadJson.toByteArray(Charsets.UTF_8))
        val tagStart = sealed.size - GCM_TAG_BITS / 8

        return VaultEnvelope(
            format = VAULT_FORMAT,
            kdf = VaultKdf(KDF_NAME, iterations, b64.encodeToString(salt)),
            iv = b64.encodeToString(iv),
            ciphertext = b64.encodeToString(sealed.copyOfRange(0, tagStart)),
            tag = b64.encodeToString(sealed.copyOfRange(tagStart, sealed.size)),
            version = version,
            updatedAt = updatedAt,
            updatedBy = updatedBy
        )
    }

    fun open(envelope: VaultEnvelope, key: ByteArray): String {
        if (envelope.format != VAULT_FORMAT) {
            throw VaultLockedException("Unsupported vault format ${envelope.format}")
        }

        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                SecretKeySpec(key, "AES"),
                GCMParameterSpec(GCM_TAG_BITS, b64d.decode(envelope.iv))
            )
            cipher.updateAAD(
                associatedData(
                    envelope.format,
                    envelope.version,
                    envelope.updatedAt,
                    envelope.updatedBy
                )
            )

            val plaintext = cipher.doFinal(
                b64d.decode(envelope.ciphertext) + b64d.decode(envelope.tag)
            )
            return String(plaintext, Charsets.UTF_8)
        } catch (e: Exception) {
            // Wrong passphrase and tampered envelope are the same answer here,
            // and telling them apart is not the caller's business.
            throw VaultLockedException()
        }
    }

    fun generateSalt(): ByteArray = ByteArray(16).also { java.security.SecureRandom().nextBytes(it) }

    /**
     * A short fingerprint of the key, shown on both devices.
     *
     * Comparing these tells the user the two passphrases match without either
     * device sending anything that could reveal one.
     */
    fun keyFingerprint(key: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(FINGERPRINT_DOMAIN.toByteArray(Charsets.UTF_8))
        digest.update(key)
        return digest.digest().joinToString("") { "%02x".format(it) }.take(12)
    }

    /** Constant-time, because fingerprints arrive off the wire */
    fun fingerprintsMatch(a: String, b: String): Boolean {
        val left = a.toByteArray(Charsets.UTF_8)
        val right = b.toByteArray(Charsets.UTF_8)
        if (left.size != right.size) return false
        var diff = 0
        for (i in left.indices) diff = diff or (left[i].toInt() xor right[i].toInt())
        return diff == 0
    }

    fun encode(envelope: VaultEnvelope): String = json.encodeToString(VaultEnvelope.serializer(), envelope)
    fun decode(text: String): VaultEnvelope = json.decodeFromString(VaultEnvelope.serializer(), text)
    fun decode(element: JsonElement): VaultEnvelope = json.decodeFromJsonElement(VaultEnvelope.serializer(), element)
}
