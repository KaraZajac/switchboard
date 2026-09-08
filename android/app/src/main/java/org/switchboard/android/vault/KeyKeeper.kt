package org.switchboard.android.vault

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keeping the vault open across restarts.
 *
 * The vault key lives in memory, which is the right default: a phone that is
 * off reveals nothing without the passphrase. But a standby device is restarted
 * by the system all the time — a memory-pressure kill, a `START_STICKY` restart,
 * a reboot — and a phone that needs someone to type a passphrase before it can
 * take over is not standby at all. It would sit there, next to a dead desktop,
 * waiting to be asked.
 *
 * So the user can choose to keep it open. The vault key is then wrapped by a
 * key that lives in the Android Keystore — hardware-backed where the device has
 * it, and never extractable — and only the wrapped bytes are written down.
 *
 * What that does and does not protect:
 *
 * - Someone who copies the app's files gets nothing: the wrapping key cannot
 *   leave the device, so the vault stays sealed.
 * - Someone holding the unlocked phone can use the app, and therefore the
 *   credentials in it, exactly as the owner can.
 *
 * The second point is why this is a choice and not a default, and why the UI
 * says so plainly rather than calling it "remember me".
 */
class KeyKeeper(context: Context) {

    private val prefs = context.getSharedPreferences("switchboard-vault", Context.MODE_PRIVATE)

    /** Whether a key is being kept for the next start */
    val isKept: Boolean get() = prefs.contains(WRAPPED) && prefs.contains(WRAP_IV)

    /**
     * Wrap the vault key and write it down.
     *
     * Silently does nothing if the keystore refuses — an old or unusual device
     * should still be able to unlock by hand rather than fail to start.
     */
    fun keep(vaultKey: ByteArray): Boolean = runCatching {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey())

        val wrapped = cipher.doFinal(vaultKey)
        prefs.edit()
            .putString(WRAPPED, Base64.getEncoder().encodeToString(wrapped))
            .putString(WRAP_IV, Base64.getEncoder().encodeToString(cipher.iv))
            .apply()
        true
    }.getOrDefault(false)

    /**
     * Unwrap the vault key, or null.
     *
     * Null covers every way this can legitimately fail — nothing kept, the
     * keystore entry invalidated by a screen-lock change, a restored backup on
     * different hardware — and all of them mean the same thing to the caller:
     * ask for the passphrase.
     */
    fun recover(): ByteArray? = runCatching {
        val wrapped = prefs.getString(WRAPPED, null) ?: return null
        val iv = prefs.getString(WRAP_IV, null) ?: return null

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            wrappingKey(),
            GCMParameterSpec(TAG_BITS, Base64.getDecoder().decode(iv))
        )
        cipher.doFinal(Base64.getDecoder().decode(wrapped))
    }.getOrNull()

    /** Stop keeping it, and take the keystore entry with it */
    fun forget() {
        prefs.edit().remove(WRAPPED).remove(WRAP_IV).apply()
        runCatching {
            KeyStore.getInstance(PROVIDER).apply { load(null) }.deleteEntry(KEY_ALIAS)
        }
    }

    /**
     * The keystore key that wraps the vault key.
     *
     * Deliberately usable while the screen is locked: the whole point is that
     * this phone can take over at three in the morning without being woken.
     * Requiring device unlock would make the key unusable exactly when it is
     * needed.
     */
    private fun wrappingKey(): SecretKey {
        val store = KeyStore.getInstance(PROVIDER).apply { load(null) }
        (store.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
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
        const val KEY_ALIAS = "switchboard-vault-wrapping-key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
        const val WRAPPED = "wrappedVaultKey"
        const val WRAP_IV = "wrappedVaultKeyIv"
    }
}
