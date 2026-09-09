package org.switchboard.android.pairing

import android.content.Context
import java.util.Base64
import org.switchboard.android.vault.KeystoreSeal

/**
 * What this phone is, to the desktop.
 *
 * Two things, and both are credentials. The secret key is this device's iroh
 * identity — the desktop's list of paired devices is a list of the public
 * halves, so whoever holds this key can be this phone, join the session and
 * read everything it can. The ticket is the address and the introduction that
 * goes with it.
 *
 * Both used to sit in SharedPreferences in the clear. That is private to the
 * app and unreadable by other apps, which is not nothing — but it is not
 * private to a backup. Android's automatic backup sweeps app preferences into
 * the cloud, and a restored copy of those two values is a working second phone.
 *
 * So they are sealed with a key that cannot leave this device. A copy restored
 * onto other hardware unseals to nothing, which is the right answer: that
 * phone should pair for itself.
 *
 * When the keystore will not play — an old device, a broken vendor
 * implementation — this falls back to storing them as they were rather than
 * refusing to run, because a phone that cannot keep its identity has to be
 * paired again on every launch. [isSealed] says which happened, so the UI does
 * not have to guess.
 */
class DeviceIdentity(
    private val store: Store,
    private val seal: KeystoreSeal?
) {

    /** Somewhere small to write two strings: preferences in the app, a map in tests */
    interface Store {
        fun read(key: String): String?
        fun write(key: String, value: String?)
    }

    constructor(context: Context) : this(
        PreferenceStore(context.getSharedPreferences("switchboard", Context.MODE_PRIVATE)),
        KeystoreSeal("switchboard-device-wrapping-key")
    )

    /**
     * Whether what is written down is actually sealed.
     *
     * Asked rather than remembered, so it is true of what is on disk right now
     * and not of whatever this instance last happened to do.
     */
    fun isSealed(): Boolean = store.read("$SECRET_KEY$SEALED_SUFFIX") != null

    /**
     * This device's iroh identity, created once and kept.
     *
     * A phone that generated a new key on every launch would have to be paired
     * again every time, so this is the one value that must survive everything.
     */
    fun secretKey(): ByteArray {
        // The old form was base64 under the bare key
        read(SECRET_KEY) { runCatching { Base64.getDecoder().decode(it) }.getOrNull() }
            ?.takeIf { it.size == 32 }
            ?.let { return it }

        val key = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
        remember(SECRET_KEY, key)
        return key
    }

    /** How to reach the desktop again, or null if this phone has never paired */
    fun ticket(): String? =
        // The old form was the ticket itself, written straight in — which is
        // also valid base64, so reading it the way the key is read would decode
        // to plausible nonsense rather than fail.
        read(TICKET) { it.toByteArray(Charsets.UTF_8) }
            ?.toString(Charsets.UTF_8)
            ?.takeIf { it.isNotBlank() }

    fun rememberTicket(ticket: String) = remember(TICKET, ticket.toByteArray(Charsets.UTF_8))

    /** Unpairing. The identity stays: it is this phone, not this pairing. */
    fun forgetTicket() {
        store.write(TICKET, null)
        store.write("$TICKET$SEALED_SUFFIX", null)
        store.write("$TICKET$PLAIN_SUFFIX", null)
    }

    // ── how the two are actually written ─────────────────────────────

    /**
     * Read a secret, sealed or not, and seal it if it was not.
     *
     * [legacy] is how the value used to be written, which differs between the
     * two and is the whole reason this takes a function. The first read after
     * an upgrade is also the migration: seal what was found, write that, and
     * take the plaintext away.
     */
    private fun read(key: String, legacy: (String) -> ByteArray?): ByteArray? {
        store.read("$key$SEALED_SUFFIX")?.let { stored ->
            unseal(stored)?.let { return it }
            // Sealed by a key that is gone — a restored backup, or a screen-lock
            // change that invalidated it. There is nothing to recover.
            store.write("$key$SEALED_SUFFIX", null)
            return null
        }

        store.read("$key$PLAIN_SUFFIX")?.let { stored ->
            return runCatching { Base64.getDecoder().decode(stored) }.getOrNull()
        }

        val bytes = store.read(key)?.let(legacy) ?: return null
        remember(key, bytes)
        return bytes
    }

    private fun remember(key: String, value: ByteArray) {
        val sealedForm = seal?.seal(value)?.let {
            "${Base64.getEncoder().encodeToString(it.iv)}.${Base64.getEncoder().encodeToString(it.bytes)}"
        }

        if (sealedForm != null) {
            store.write("$key$SEALED_SUFFIX", sealedForm)
        } else {
            // No keystore. Keeping it in the clear is the lesser harm: the
            // alternative is a phone that cannot stay paired at all.
            store.write("$key$PLAIN_SUFFIX", Base64.getEncoder().encodeToString(value))
        }

        // Either way the old shape goes. It is only ever read, never written,
        // so the two forms cannot be confused for one another.
        store.write(key, null)
    }

    private fun unseal(stored: String): ByteArray? {
        val parts = stored.split('.')
        if (parts.size != 2) return null
        return runCatching {
            KeystoreSeal.Sealed(
                Base64.getDecoder().decode(parts[1]),
                Base64.getDecoder().decode(parts[0])
            )
        }.getOrNull()?.let { seal?.open(it) }
    }

    private class PreferenceStore(
        private val prefs: android.content.SharedPreferences
    ) : Store {
        override fun read(key: String): String? = prefs.getString(key, null)
        override fun write(key: String, value: String?) {
            prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
        }
    }

    private companion object {
        const val SECRET_KEY = "secretKey"
        const val TICKET = "ticket"
        const val SEALED_SUFFIX = "Sealed"

        /**
         * Where an unsealed value goes.
         *
         * Not back under the bare key: that one holds what an older version
         * wrote, and the two were written differently — base64 for the
         * identity, the ticket as itself. Keeping them apart means a read
         * never has to guess which it is looking at.
         */
        const val PLAIN_SUFFIX = "Plain"
    }
}
