package org.switchboard.android

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.switchboard.android.irc.Sts
import org.switchboard.android.irc.StsPolicy
import java.time.Instant

/**
 * Strict Transport Security.
 *
 * The whole value of this is in the connection *after* the one that learned the
 * policy: a client that only obeys it while the server is repeating it has
 * gained nothing. So the cases here are mostly about what happens later.
 */
class StsTest {

    /** A store that keeps what it is given, like the real one on disk */
    private class Remembering : Sts.Store {
        val kept = mutableMapOf<String, StsPolicy>()
        override fun load(): List<StsPolicy> = kept.values.toList()
        override fun save(policy: StsPolicy) { kept[policy.host] = policy }
        override fun forget(host: String) { kept.remove(host) }
    }

    private lateinit var store: Remembering

    @Before
    fun setUp() {
        store = Remembering()
        Sts.useStore(store)
    }

    @After
    fun tearDown() = Sts.forgetEverything()

    // ── reading what the server said ──────────────────────────────────

    @Test
    fun `reads a policy off the capability value`() {
        assertEquals(6697 to 2592000L, Sts.parse("port=6697,duration=2592000"))
        assertEquals(6697 to 2592000L, Sts.parse("duration=2592000,port=6697"))
    }

    @Test
    fun `refuses a half a policy rather than guessing at it`() {
        assertNull(Sts.parse(null))
        assertNull(Sts.parse(""))
        assertNull(Sts.parse("port=6697"))
        assertNull(Sts.parse("duration=100"))
        assertNull(Sts.parse("port=notaport,duration=100"))
        assertNull(Sts.parse("port=99999,duration=100"))
    }

    // ── obeying it ────────────────────────────────────────────────────

    @Test
    fun `sends a later plaintext connection to the secure port`() {
        Sts.remember("irc.example.org", 6697, 2592000)

        assertEquals(6697 to true, Sts.upgradeFor("irc.example.org", 6667, false))
    }

    @Test
    fun `leaves a connection that already satisfies the policy alone`() {
        Sts.remember("irc.example.org", 6697, 2592000)

        assertNull(Sts.upgradeFor("irc.example.org", 6697, true))
    }

    @Test
    fun `moves a TLS connection on the wrong port to the right one`() {
        Sts.remember("irc.example.org", 6697, 2592000)

        assertEquals(6697 to true, Sts.upgradeFor("irc.example.org", 7000, true))
    }

    @Test
    fun `has nothing to say about a host it was never told about`() {
        assertNull(Sts.upgradeFor("irc.other.org", 6667, false))
    }

    @Test
    fun `matches the host whatever its case`() {
        Sts.remember("IRC.Example.ORG", 6697, 2592000)

        assertEquals(6697 to true, Sts.upgradeFor("irc.example.org", 6667, false))
    }

    // ── forgetting it ─────────────────────────────────────────────────

    @Test
    fun `a zero duration withdraws the policy`() {
        Sts.remember("irc.example.org", 6697, 2592000)
        Sts.remember("irc.example.org", 6697, 0)

        assertNull(Sts.upgradeFor("irc.example.org", 6667, false))
        assertTrue(store.kept.isEmpty())
    }

    @Test
    fun `an expired policy stops applying, and is not kept`() {
        Sts.remember("irc.example.org", 6697, 60)

        val later = Instant.now().plusSeconds(120)
        assertNull(Sts.policyFor("irc.example.org", later))
        assertTrue(store.kept.isEmpty())
    }

    // ── surviving a restart ───────────────────────────────────────────

    /**
     * The case the whole feature exists for: the app is closed, reopened, and
     * the very first connection must already know to use TLS.
     */
    @Test
    fun `a policy learned before a restart still applies after one`() {
        Sts.remember("irc.example.org", 6697, 2592000)

        // A fresh process, reading the same store back
        Sts.forgetEverything()
        Sts.useStore(store)

        assertEquals(6697 to true, Sts.upgradeFor("irc.example.org", 6667, false))
    }
}
