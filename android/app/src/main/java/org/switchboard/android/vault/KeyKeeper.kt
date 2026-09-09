package org.switchboard.android.vault

import android.content.Context
import java.util.Base64

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
 * So the user can choose to keep it open. The vault key is then wrapped by
 * [KeystoreSeal] and only the wrapped bytes are written down, which means
 * someone who copies the app's files gets nothing — and someone holding the
 * unlocked phone gets everything, exactly as the owner does.
 *
 * That second half is why this is a choice and not a default, and why the UI
 * says so plainly rather than calling it "remember me".
 */
class KeyKeeper(context: Context) {

    private val prefs = context.getSharedPreferences("switchboard-vault", Context.MODE_PRIVATE)
    private val seal = KeystoreSeal(KEY_ALIAS)

    /** Whether a key is being kept for the next start */
    val isKept: Boolean get() = prefs.contains(WRAPPED) && prefs.contains(WRAP_IV)

    /**
     * Wrap the vault key and write it down.
     *
     * Silently does nothing if the keystore refuses — an old or unusual device
     * should still be able to unlock by hand rather than fail to start.
     */
    fun keep(vaultKey: ByteArray): Boolean {
        val sealed = seal.seal(vaultKey) ?: return false
        prefs.edit()
            .putString(WRAPPED, Base64.getEncoder().encodeToString(sealed.bytes))
            .putString(WRAP_IV, Base64.getEncoder().encodeToString(sealed.iv))
            .apply()
        return true
    }

    /**
     * Unwrap the vault key, or null.
     *
     * Null covers every way this can legitimately fail — nothing kept, the
     * keystore entry invalidated by a screen-lock change, a restored backup on
     * different hardware — and all of them mean the same thing to the caller:
     * ask for the passphrase.
     */
    fun recover(): ByteArray? {
        val wrapped = prefs.getString(WRAPPED, null) ?: return null
        val iv = prefs.getString(WRAP_IV, null) ?: return null

        return runCatching {
            KeystoreSeal.Sealed(
                Base64.getDecoder().decode(wrapped),
                Base64.getDecoder().decode(iv)
            )
        }.getOrNull()?.let(seal::open)
    }

    /** Stop keeping it, and take the keystore entry with it */
    fun forget() {
        prefs.edit().remove(WRAPPED).remove(WRAP_IV).apply()
        seal.destroy()
    }

    private companion object {
        const val KEY_ALIAS = "switchboard-vault-wrapping-key"
        const val WRAPPED = "wrappedVaultKey"
        const val WRAP_IV = "wrappedVaultKeyIv"
    }
}
