package org.switchboard.android.vault

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Wrapping a secret in something that cannot leave the phone.
 *
 * The key doing the wrapping lives in the Android Keystore — hardware-backed
 * where the device has it — and is never extractable. What that buys is
 * narrow and worth stating exactly: bytes copied out of the app's files, or
 * swept into a cloud backup and restored onto different hardware, unseal to
 * nothing. Someone holding this unlocked phone can still use the app, and
 * therefore everything the app can reach.
 *
 * Deliberately usable while the screen is locked. A standby device has to be
 * able to take over at three in the morning without being woken, and a key
 * that requires an unlock is unusable exactly when it is needed.
 */
class KeystoreSeal(private val alias: String) {

    /** Ciphertext and the nonce it was made with, which have to travel together */
    data class Sealed(val bytes: ByteArray, val iv: ByteArray) {
        override fun equals(other: Any?): Boolean =
            other is Sealed && bytes.contentEquals(other.bytes) && iv.contentEquals(other.iv)

        override fun hashCode(): Int = 31 * bytes.contentHashCode() + iv.contentHashCode()
    }

    /**
     * Seal, or null if the keystore refuses.
     *
     * Null is a real answer rather than an error: an old or unusual device that
     * cannot do this should still be able to run the app, and the callers here
     * all have something sensible to do without it.
     */
    fun seal(plain: ByteArray): Sealed? = runCatching {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey())
        Sealed(cipher.doFinal(plain), cipher.iv)
    }.getOrNull()

    /**
     * Unseal, or null.
     *
     * Null covers every way this legitimately fails — nothing sealed yet, the
     * keystore entry invalidated by a screen-lock change, a backup restored
     * onto other hardware — and they all mean the same thing to the caller.
     */
    fun open(sealed: Sealed): ByteArray? = runCatching {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(TAG_BITS, sealed.iv))
        cipher.doFinal(sealed.bytes)
    }.getOrNull()

    /** Delete the wrapping key, so everything it sealed is gone for good */
    fun destroy() {
        runCatching {
            KeyStore.getInstance(PROVIDER).apply { load(null) }.deleteEntry(alias)
        }
    }

    private fun wrappingKey(): SecretKey {
        val store = KeyStore.getInstance(PROVIDER).apply { load(null) }
        (store.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    private companion object {
        const val PROVIDER = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
    }
}
