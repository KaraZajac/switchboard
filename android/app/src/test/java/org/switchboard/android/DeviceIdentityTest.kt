package org.switchboard.android

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64
import org.switchboard.android.pairing.DeviceIdentity

/**
 * This phone's identity, and the ticket that reaches the desktop.
 *
 * Both are credentials: the secret key is what the desktop's paired-device
 * list is a list of, so a copy of it is a working second phone. They were
 * written in the clear, where Android's backup would sweep them into the
 * cloud, and now they are sealed by a key that cannot leave the device.
 *
 * The keystore itself cannot run in a JVM test, so what is pinned here is
 * everything around it: that an upgrade migrates rather than loses, that the
 * plaintext is actually taken away, and that a phone with no keystore still
 * stays paired instead of refusing to work.
 */
class DeviceIdentityTest {

    /** A real one, off a paired phone */
    private val LEGACY_TICKET =
        "endpointacycgpan3xguitejsbhjs7neseprkxx73x3cfl6nn5orc76qybstqbiaenuhi5dqom5c" +
            "6l3vonstcljrfzzgk3dbpexg4mbonfzg62bonruw42zof4aqacqaaibo5widaeaauaacapxnsay" +
            "baafauct453mqgaiai6rrok7o3ebq"

    /** What SharedPreferences does, minus Android */
    private class FakeStore(
        val values: MutableMap<String, String> = mutableMapOf()
    ) : DeviceIdentity.Store {
        override fun read(key: String): String? = values[key]
        override fun write(key: String, value: String?) {
            if (value == null) values.remove(key) else values[key] = value
        }
    }

    // ── with no keystore at all ──────────────────────────────────────

    @Test
    fun `an identity is made once and then kept`() {
        val store = FakeStore()
        val first = DeviceIdentity(store, null).secretKey()
        val second = DeviceIdentity(store, null).secretKey()

        assertEquals(32, first.size)
        assertArrayEquals(first, second)
    }

    @Test
    fun `a phone with no keystore still stays paired`() {
        val store = FakeStore()
        val identity = DeviceIdentity(store, null)

        identity.rememberTicket("ticket-for-the-desktop")

        assertEquals("ticket-for-the-desktop", DeviceIdentity(store, null).ticket())
        assertFalse("nothing should claim to be sealed here", identity.isSealed())
    }

    @Test
    fun `never paired means no ticket, not an empty one`() {
        assertNull(DeviceIdentity(FakeStore(), null).ticket())
    }

    @Test
    fun `unpairing takes the ticket and leaves the identity`() {
        val store = FakeStore()
        val identity = DeviceIdentity(store, null)
        val key = identity.secretKey()
        identity.rememberTicket("ticket")

        identity.forgetTicket()

        assertNull(identity.ticket())
        assertArrayEquals("this is still the same phone", key, identity.secretKey())
    }

    // ── the upgrade from plaintext ───────────────────────────────────

    /**
     * What an older install actually left behind, taken off a paired phone: the
     * key base64-encoded, and the ticket written straight in as itself. It has
     * to still work, because the alternative is every paired phone silently
     * needing to pair again.
     */
    @Test
    fun `reads what an older version wrote in the clear`() {
        val key = ByteArray(32) { it.toByte() }
        val store = FakeStore(
            mutableMapOf(
                "secretKey" to Base64.getEncoder().encodeToString(key),
                "ticket" to LEGACY_TICKET
            )
        )

        val identity = DeviceIdentity(store, null)
        assertArrayEquals(key, identity.secretKey())
        assertEquals(LEGACY_TICKET, identity.ticket())
    }

    /**
     * The trap in that migration. An iroh ticket is lowercase base32, every
     * character of which is also a base64 character — so decoding it the way
     * the key is decoded does not fail. It succeeds, and hands back plausible
     * nonsense that the phone would then try to dial.
     */
    @Test
    fun `an old ticket is not mistaken for base64`() {
        val store = FakeStore(mutableMapOf("ticket" to LEGACY_TICKET))

        assertEquals(LEGACY_TICKET, DeviceIdentity(store, null).ticket())
    }

    /**
     * The old shape is read once and then gone, whether or not there was a
     * keystore to seal it with. Leaving it would mean two places to keep in
     * step, and the reader having to guess which of them it is looking at.
     */
    @Test
    fun `migrating takes the old shape away`() {
        val store = FakeStore(mutableMapOf("ticket" to LEGACY_TICKET))

        assertEquals(LEGACY_TICKET, DeviceIdentity(store, null).ticket())

        assertNull(store.values["ticket"])
        assertEquals(
            "and it still reads back the same",
            LEGACY_TICKET,
            DeviceIdentity(store, null).ticket()
        )
    }

    /** A value we cannot make sense of is not a value */
    @Test
    fun `a corrupt stored identity is replaced rather than crashed on`() {
        val store = FakeStore(mutableMapOf("secretKey" to "this is not base64 at all!!"))

        val key = DeviceIdentity(store, null).secretKey()
        assertEquals(32, key.size)
    }

    /** Too short to be a key: an earlier bug, or a truncated write */
    @Test
    fun `an identity of the wrong length is replaced`() {
        val store = FakeStore(
            mutableMapOf(
                "secretKey" to Base64.getEncoder().encodeToString(ByteArray(16))
            )
        )

        assertEquals(32, DeviceIdentity(store, null).secretKey().size)
    }

    // ── what is actually written down ────────────────────────────────

    @Test
    fun `the ticket is not stored as the ticket`() {
        val store = FakeStore()
        DeviceIdentity(store, null).rememberTicket("ticket-for-the-desktop")

        assertFalse(
            "the ticket must never be readable straight out of preferences",
            store.values.values.any { it.contains("ticket-for-the-desktop") }
        )
    }

    /**
     * A sealed value the keystore can no longer open — a restored backup, or a
     * screen-lock change that invalidated the key. There is nothing to recover,
     * and the honest answer is that this phone is not paired.
     */
    @Test
    fun `a sealed value that will not open is not a ticket`() {
        val store = FakeStore(mutableMapOf("ticketSealed" to "AAAA.BBBB"))

        assertNull(DeviceIdentity(store, null).ticket())
        assertNull("and it is cleared rather than tried forever", store.values["ticketSealed"])
    }

    @Test
    fun `a sealed identity that will not open makes a new one`() {
        val store = FakeStore(mutableMapOf("secretKeySealed" to "AAAA.BBBB"))

        assertNotNull(DeviceIdentity(store, null).secretKey())
        assertEquals(32, DeviceIdentity(store, null).secretKey().size)
    }

    @Test
    fun `sealing is not claimed when there is no keystore`() {
        val identity = DeviceIdentity(FakeStore(), null)
        identity.secretKey()

        assertFalse(identity.isSealed())
        assertTrue("and the identity is still kept", identity.secretKey().size == 32)
    }
}
