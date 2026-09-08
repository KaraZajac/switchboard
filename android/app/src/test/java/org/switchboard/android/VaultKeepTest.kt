package org.switchboard.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.switchboard.android.vault.VaultCrypto

/**
 * Keeping the vault open across a restart.
 *
 * The key lives in memory by default, which is right — and, for a standby
 * device, not enough on its own. Android restarts apps whenever it likes, and a
 * phone that must be asked for a passphrase before it can take over will sit
 * beside a dead desktop doing nothing. These pin the properties that make it
 * safe: what is written down, and what a stale key must not open.
 *
 * The keystore itself cannot run in a JVM test, so [org.switchboard.android.vault.KeyKeeper]
 * is exercised on the device; this covers the sealing either side of it.
 */
class VaultKeepTest {

    private val passphrase = "keep-me-open"
    private val salt = ByteArray(16) { (it * 5 + 1).toByte() }

    @Test
    fun `a kept key opens the vault without the passphrase`() {
        val key = VaultCrypto.deriveKey(passphrase, salt, 1000)
        val envelope = VaultCrypto.seal(
            payloadJson = """{"version":1,"servers":[]}""",
            key = key,
            salt = salt,
            version = 1,
            updatedAt = "2026-09-08T12:00:00.000Z",
            updatedBy = "desktop",
            iterations = 1000
        )

        // This is what the keystore hands back after a restart: the same bytes
        val recovered = key.copyOf()
        assertEquals("""{"version":1,"servers":[]}""", VaultCrypto.open(envelope, recovered))
    }

    @Test
    fun `a kept key still opens the vault after a reseal`() {
        // A reseal keeps the salt, which is what lets a device that is already
        // open stay open when the desktop changes a server
        val key = VaultCrypto.deriveKey(passphrase, salt, 1000)
        val first = VaultCrypto.seal(
            """{"version":1,"servers":[]}""", key, salt, 1, "2026-09-08T12:00:00.000Z", "desktop", 1000
        )
        val second = VaultCrypto.seal(
            """{"version":2,"servers":[]}""", key, salt, 2, "2026-09-08T12:05:00.000Z", "desktop", 1000
        )

        assertNotNull(VaultCrypto.open(first, key))
        assertEquals("""{"version":2,"servers":[]}""", VaultCrypto.open(second, key))
    }

    @Test
    fun `a kept key does not open a vault sealed under a new passphrase`() {
        val old = VaultCrypto.deriveKey(passphrase, salt, 1000)
        val newSalt = ByteArray(16) { 9 }
        val fresh = VaultCrypto.deriveKey("a different passphrase", newSalt, 1000)

        val resealed = VaultCrypto.seal(
            """{"version":3,"servers":[]}""", fresh, newSalt, 3, "2026-09-08T12:10:00.000Z", "desktop", 1000
        )

        // The phone must ask again rather than silently staying "unlocked"
        try {
            VaultCrypto.open(resealed, old)
            error("a stale kept key must not open a re-passphrased vault")
        } catch (e: Exception) {
            assertTrue(e is org.switchboard.android.vault.VaultLockedException)
        }
    }

    @Test
    fun `the sealed envelope never contains the key or the passphrase`() {
        val key = VaultCrypto.deriveKey(passphrase, salt, 1000)
        val envelope = VaultCrypto.seal(
            """{"version":1,"servers":[{"id":"a","name":"N","host":"h","nick":"k","saslPassword":"hunter2"}]}""",
            key, salt, 1, "2026-09-08T12:00:00.000Z", "desktop", 1000
        )

        val onDisk = VaultCrypto.encode(envelope)
        assertFalse(onDisk.contains(passphrase))
        assertFalse(onDisk.contains("hunter2"))
        assertFalse(onDisk.contains(key.joinToString("") { "%02x".format(it) }))
    }
}
